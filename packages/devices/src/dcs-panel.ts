import type { LcdFrame, SpiDevice, SpiTransaction } from "@replicas/core";

/** MIPI DCS commands of the ST7789 family that place pixels (MIPI DCS v1.02 section 9, ST7789V datasheet section 9). */
class Dcs {
  static readonly SOFTWARE_RESET = 0x01;
  static readonly SLEEP_IN = 0x10;
  static readonly SLEEP_OUT = 0x11;
  static readonly INVERSION_OFF = 0x20;
  static readonly INVERSION_ON = 0x21;
  static readonly DISPLAY_OFF = 0x28;
  static readonly DISPLAY_ON = 0x29;
  static readonly COLUMN_ADDRESS = 0x2a;
  static readonly ROW_ADDRESS = 0x2b;
  static readonly MEMORY_WRITE = 0x2c;
  static readonly MEMORY_ACCESS_CONTROL = 0x36;
  static readonly MIRROR_COLUMNS = 0x40;
  static readonly MIRROR_ROWS = 0x80;
  static readonly SWAP_AXES = 0x20;

  private constructor() {}
}

const BYTE_BITS = 8;
const ADDRESS_BYTES = 4;
const COLOUR_MASK = 0xffff;
const BYTE_MASK = 0xff;
const BYTES_PER_PIXEL = 2;
const START_HIGH = 0;
const START_LOW = 1;
const END_HIGH = 2;
const END_LOW = 3;

export interface DcsPanelGeometry {
  readonly ramColumns: number;
  readonly ramRows: number;
  readonly visibleColumns: number;
  readonly visibleRows: number;
  readonly columnOffset: number;
  readonly rowOffset: number;
  /** The glass is mounted so that it reads the RAM mirrored; firmware compensates with MADCTL. */
  readonly glassMirrorsColumns: boolean;
  readonly glassMirrorsRows: boolean;
}

/**
 * A 4-wire SPI display controller of the ST7789 family. Commands and data are told apart by the level of the
 * data/command pin at the moment of each transaction. The RAM is the controller's; the glass shows a window of
 * it (the geometry), read mirrored if the glass is mounted that way. MADCTL mirrors apply as the pixels are written, as upstream's model does. An IPS panel shows
 * the stored colour only while inversion is on.
 */
export class DcsPanel implements SpiDevice {
  private readonly ram: Uint16Array;
  private command = 0;
  private parameterCount = 0;
  private readonly parameters = new Uint8Array(ADDRESS_BYTES);
  private columnStart = 0;
  private columnEnd: number;
  private rowStart = 0;
  private rowEnd: number;
  private column = 0;
  private row = 0;
  private memoryAccess = 0;
  private inverted = false;
  private asleep = true;
  private on = false;
  private pendingHigh: number | undefined;
  private writes = 0;

  constructor(private readonly geometry: DcsPanelGeometry) {
    this.ram = new Uint16Array(geometry.ramColumns * geometry.ramRows);
    this.columnEnd = geometry.ramColumns - 1;
    this.rowEnd = geometry.ramRows - 1;
  }

  transfer(transaction: SpiTransaction): Uint8Array {
    for (const byte of transaction.mosi) {
      if (transaction.dataCommandLevel) this.data(byte);
      else this.commandByte(byte);
    }
    return new Uint8Array(0);
  }

  /** RAMWR commands seen: the number of times the firmware started a write of pixels. */
  memoryWrites(): number {
    return this.writes;
  }

  isShowing(): boolean {
    return this.on && !this.asleep;
  }

  isInverted(): boolean {
    return this.inverted;
  }

  /** What the glass shows, upright, as big-endian RGB565; undefined until something is on. */
  frame(): LcdFrame | undefined {
    if (!this.isShowing()) return undefined;
    const { visibleColumns, visibleRows, columnOffset, rowOffset, ramColumns, glassMirrorsColumns, glassMirrorsRows } = this.geometry;
    const rgb565 = new Uint8Array(visibleColumns * visibleRows * BYTES_PER_PIXEL);
    for (let y = 0; y < visibleRows; y += 1) {
      for (let x = 0; x < visibleColumns; x += 1) {
        const row = glassMirrorsRows ? visibleRows - 1 - y : y;
        const column = glassMirrorsColumns ? visibleColumns - 1 - x : x;
        const stored = this.ram[(row + rowOffset) * ramColumns + column + columnOffset] ?? 0;
        const shown = this.inverted ? stored : ~stored & COLOUR_MASK;
        const at = (y * visibleColumns + x) * BYTES_PER_PIXEL;
        rgb565[at] = shown >> BYTE_BITS;
        rgb565[at + 1] = shown & BYTE_MASK;
      }
    }
    return { width: visibleColumns, height: visibleRows, rgb565 };
  }

  private commandByte(byte: number): void {
    this.command = byte;
    this.parameterCount = 0;
    this.pendingHigh = undefined;
    switch (byte) {
      case Dcs.SOFTWARE_RESET:
        this.reset();
        break;
      case Dcs.SLEEP_OUT:
        this.asleep = false;
        break;
      case Dcs.SLEEP_IN:
        this.asleep = true;
        break;
      case Dcs.INVERSION_ON:
        this.inverted = true;
        break;
      case Dcs.INVERSION_OFF:
        this.inverted = false;
        break;
      case Dcs.DISPLAY_ON:
        this.on = true;
        break;
      case Dcs.DISPLAY_OFF:
        this.on = false;
        break;
      case Dcs.MEMORY_WRITE:
        this.column = this.columnStart;
        this.row = this.rowStart;
        this.writes += 1;
        break;
    }
  }

  private data(byte: number): void {
    switch (this.command) {
      case Dcs.COLUMN_ADDRESS:
      case Dcs.ROW_ADDRESS:
        this.address(byte);
        break;
      case Dcs.MEMORY_ACCESS_CONTROL:
        this.memoryAccess = byte;
        break;
      case Dcs.MEMORY_WRITE:
        this.pixelByte(byte);
        break;
    }
  }

  private address(byte: number): void {
    if (this.parameterCount < ADDRESS_BYTES) this.parameters[this.parameterCount] = byte;
    this.parameterCount += 1;
    if (this.parameterCount !== ADDRESS_BYTES) return;
    const start = ((this.parameters[START_HIGH] ?? 0) << BYTE_BITS) | (this.parameters[START_LOW] ?? 0);
    const end = ((this.parameters[END_HIGH] ?? 0) << BYTE_BITS) | (this.parameters[END_LOW] ?? 0);
    if (this.command === Dcs.COLUMN_ADDRESS) {
      this.columnStart = start;
      this.columnEnd = end;
      this.column = start;
    } else {
      this.rowStart = start;
      this.rowEnd = end;
      this.row = start;
    }
  }

  private pixelByte(byte: number): void {
    if (this.pendingHigh === undefined) {
      this.pendingHigh = byte;
      return;
    }
    this.place((this.pendingHigh << BYTE_BITS) | byte);
    this.pendingHigh = undefined;
  }

  private place(colour: number): void {
    const { ramColumns, ramRows } = this.geometry;
    let column = this.column;
    let row = this.row;
    if ((this.memoryAccess & Dcs.SWAP_AXES) !== 0) [column, row] = [row, column];
    if ((this.memoryAccess & Dcs.MIRROR_COLUMNS) !== 0) column = ramColumns - 1 - Math.min(column, ramColumns - 1);
    if ((this.memoryAccess & Dcs.MIRROR_ROWS) !== 0) row = ramRows - 1 - Math.min(row, ramRows - 1);
    if (column < ramColumns && row < ramRows) this.ram[row * ramColumns + column] = colour;
    this.advance();
  }

  private advance(): void {
    if (this.column < this.columnEnd) {
      this.column += 1;
      return;
    }
    this.column = this.columnStart;
    this.row = this.row < this.rowEnd ? this.row + 1 : this.rowStart;
  }

  private reset(): void {
    this.memoryAccess = 0;
    this.inverted = false;
    this.asleep = true;
    this.on = false;
    this.columnStart = 0;
    this.columnEnd = this.geometry.ramColumns - 1;
    this.rowStart = 0;
    this.rowEnd = this.geometry.ramRows - 1;
  }
}
