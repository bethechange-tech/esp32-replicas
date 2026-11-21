import type { BoardDeclaration, BoardReplica, GpioEdge, LcdFrame, SpiTransaction } from "@replicas/core";
import type { GuestModule } from "./guest-module";
import { HostWire } from "./host-wire";

const IDLE_BYTE = 0xff;
const NOT_ACKNOWLEDGED = 0;
const ACKNOWLEDGED = 1;

export interface HostObservations {
  readonly gpioEdges: readonly GpioEdge[];
  readonly frames: readonly LcdFrame[];
}

/** Hands the module's board events to a `BoardReplica`, one synchronous call each, and records what a run saw. */
export class HostBoardBridge {
  private gpioEdges: GpioEdge[] = [];
  private frames: LcdFrame[] = [];
  private dataCommandLevel = false;
  private dataCommandGpio: number | undefined;

  constructor(
    private readonly replica: BoardReplica,
    private readonly guest: GuestModule,
  ) {}

  attach(declaration: BoardDeclaration): void {
    this.dataCommandGpio = declaration.dataCommandGpio;
    this.dataCommandLevel = false;
  }

  /** `host_board_gpio(records, count)`. */
  gpio(args: { pointer: number; count: number }): void {
    const length = args.count * HostWire.GPIO_RECORD_BYTES;
    const records = new DataView(this.guest.read({ pointer: args.pointer, length }).buffer);
    const edges: GpioEdge[] = Array.from({ length: args.count }, (_, index) => {
      const base = index * HostWire.GPIO_RECORD_BYTES;
      return {
        atCycle: Number(records.getBigUint64(base, true)),
        gpio: records.getUint8(base + HostWire.GPIO_PIN_OFFSET),
        level: records.getUint8(base + HostWire.GPIO_LEVEL_OFFSET) !== 0,
      };
    });
    for (const edge of edges) if (edge.gpio === this.dataCommandGpio) this.dataCommandLevel = edge.level;
    this.gpioEdges.push(...edges);
    this.replica.onGpio(edges);
  }

  /** `host_board_spi(buffer, len)`: the replica's reply is written over the request; returns its length. */
  spi(args: { pointer: number; length: number }): number {
    const request = this.guest.read({ pointer: args.pointer, length: args.length });
    const header = new DataView(request.buffer);
    const readLength = header.getUint32(HostWire.SPI_READ_LENGTH_OFFSET, true);
    const transaction: SpiTransaction = {
      host: request[HostWire.SPI_HOST_OFFSET] ?? 0,
      mosi: request.slice(HostWire.SPI_HEADER_BYTES),
      readLength,
      dataCommandLevel: this.dataCommandLevel,
    };
    const reply = this.replica.onSpi(transaction).slice(0, readLength);
    this.guest.write({ pointer: args.pointer, bytes: reply });
    return reply.length;
  }

  /** `host_board_i2c(op, arg)`: an acknowledgement (0 or 1) for start and write, the byte for a read. */
  i2c(args: { op: number; packed: number }): number {
    const bus = (args.packed >>> HostWire.I2C_BUS_SHIFT) & HostWire.BYTE_MASK;
    const address = (args.packed >>> HostWire.I2C_ADDRESS_SHIFT) & HostWire.BYTE_MASK;
    const flag = ((args.packed >>> HostWire.I2C_FLAG_SHIFT) & HostWire.BYTE_MASK) !== 0;
    const byte = args.packed & HostWire.BYTE_MASK;
    switch (args.op) {
      case HostWire.OP_START:
        return this.acknowledgement(this.replica.onI2c({ kind: "start", bus, address, read: flag }));
      case HostWire.OP_WRITE:
        return this.acknowledgement(this.replica.onI2c({ kind: "write", bus, byte }));
      case HostWire.OP_READ: {
        const value = this.replica.onI2c({ kind: "read", bus });
        return typeof value === "number" ? value & HostWire.BYTE_MASK : IDLE_BYTE;
      }
      case HostWire.OP_STOP:
        this.replica.onI2c({ kind: "stop", bus });
        return NOT_ACKNOWLEDGED;
      default:
        return NOT_ACKNOWLEDGED;
    }
  }

  /** `host_board_uart_tx(port, byte)`. */
  uartTx(args: { port: number; byte: number }): void {
    this.replica.onUart({ uart: args.port, byte: args.byte });
  }

  /** `host_board_lcd_frame(dimensions, pixels)`: width and height are packed in the first argument. */
  lcdFrame(args: { dimensions: number; pointer: number }): void {
    const width = args.dimensions >>> HostWire.FRAME_DIMENSION_BITS;
    const height = args.dimensions & ((1 << HostWire.FRAME_DIMENSION_BITS) - 1);
    const rgb565 = this.guest.read({ pointer: args.pointer, length: width * height * HostWire.RGB565_BYTES });
    const frame: LcdFrame = { width, height, rgb565 };
    this.frames.push(frame);
    this.replica.onLcdFrame(frame);
  }

  takeObservations(): HostObservations {
    const taken = { gpioEdges: this.gpioEdges, frames: this.frames };
    this.gpioEdges = [];
    this.frames = [];
    return taken;
  }

  private acknowledgement(answer: number | boolean | undefined): number {
    return answer === true || answer === ACKNOWLEDGED ? ACKNOWLEDGED : NOT_ACKNOWLEDGED;
  }
}
