import type { EngineInput, GpioEdge, GpioWatcher, I2cDevice } from "@replicas/core";

/**
 * Register map and chip identifiers as the touch driver reads them (esphome/components/cst816/touchscreen/cst816_touchscreen.h at tag 2026.10.2:
 * https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/cst816/touchscreen/cst816_touchscreen.h).
 */
class Registers {
  static readonly STATUS = 0x00;
  static readonly GESTURE = 0x01;
  static readonly TOUCH_COUNT = 0x02;
  static readonly X_HIGH = 0x03;
  static readonly X_LOW = 0x04;
  static readonly Y_HIGH = 0x05;
  static readonly Y_LOW = 0x06;
  static readonly CHIP_ID = 0xa7;
  static readonly FIRMWARE_VERSION = 0xa9;
  static readonly FACTORY_ID = 0xaa;
  static readonly SLEEP = 0xe5;
  static readonly IRQ_CONTROL = 0xfa;
  static readonly AUTO_SLEEP_DISABLE = 0xfe;

  private constructor() {}
}

export class Cst816Identity {
  /** CST816T, the value the driver names for this chip. */
  static readonly CHIP_ID = 0xb5;
  static readonly FIRMWARE_VERSION = 0x00;
  /** The driver reads the factory ID only when the chip ID reads 0, which this chip's does not. */
  static readonly FACTORY_ID = 0x00;
  /** The IRQ control value the driver writes to enable motion interrupts. */
  static readonly IRQ_ENABLE_MOTION = 0x70;

  private constructor() {}
}

export class Cst816Limits {
  /** The position fields are 12 bits: the high register keeps the top four. */
  static readonly POSITION_BITS = 12;
  static readonly POSITION_LIMIT = 0x1000;
  static readonly HIGH_NIBBLE_SHIFT = 8;
  static readonly LOW_BYTE_MASK = 0xff;
  static readonly HIGH_NIBBLE_MASK = 0x0f;
  static readonly REGISTER_SPACE = 0x100;

  private constructor() {}
}

export class Cst816PositionRefused extends Error {
  constructor(args: { axis: "x" | "y"; value: number }) {
    super(`touch ${args.axis} ${args.value} does not fit ${Cst816Limits.POSITION_BITS} bits`);
  }
}

export interface Cst816Wiring {
  readonly address: number;
  readonly interruptGpio: number;
  readonly resetGpio: number;
}

export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The CST816T touch controller: a finger on the glass is one touch with a position; the firmware reads it over I2C after the INT pin pulses low,
 * and a low level on RST clears it, with the registers the firmware wrote.
 */
export class Cst816 implements I2cDevice, GpioWatcher {
  private readonly written = new Map<number, number>();
  private pointer = Registers.STATUS;
  private writeIndex = 0;
  private finger: TouchPoint | undefined;

  constructor(private readonly wiring: Cst816Wiring) {}

  get address(): number {
    return this.wiring.address;
  }

  /** A finger lands, or slides, to this position. The chip raises no interrupt by itself here: `interrupt` is what the board drives onto INT. */
  place(point: TouchPoint): void {
    this.requireFits({ axis: "x", value: point.x });
    this.requireFits({ axis: "y", value: point.y });
    this.finger = point;
  }

  lift(): void {
    this.finger = undefined;
  }

  isTouched(): boolean {
    return this.finger !== undefined;
  }

  /** What the firmware last wrote to the IRQ control register, 0 after a reset. */
  irqControl(): number {
    return this.written.get(Registers.IRQ_CONTROL) ?? 0;
  }

  /** INT is active low: one pulse is a rising level first, so the falling edge happens whatever the pin rested at. */
  interrupt(): readonly EngineInput[] {
    return [true, false, true].map((level): EngineInput => ({ kind: "gpio", gpio: this.wiring.interruptGpio, level }));
  }

  onEdges(edges: readonly GpioEdge[]): void {
    for (const edge of edges) {
      if (edge.gpio === this.wiring.resetGpio && !edge.level) this.reset();
    }
  }

  start(args: { read: boolean }): void {
    if (!args.read) this.writeIndex = 0;
  }

  write(byte: number): boolean {
    if (this.writeIndex === 0) this.pointer = byte;
    else this.written.set(this.advance(), byte);
    this.writeIndex += 1;
    return true;
  }

  read(): number {
    return this.value(this.advance());
  }

  stop(): void {
    this.writeIndex = 0;
  }

  private reset(): void {
    this.finger = undefined;
    this.written.clear();
    this.pointer = Registers.STATUS;
    this.writeIndex = 0;
  }

  private advance(): number {
    const register = this.pointer;
    this.pointer = (this.pointer + 1) % Cst816Limits.REGISTER_SPACE;
    return register;
  }

  private value(register: number): number {
    switch (register) {
      case Registers.TOUCH_COUNT:
        return this.finger ? 1 : 0;
      case Registers.X_HIGH:
        return this.finger ? (this.finger.x >> Cst816Limits.HIGH_NIBBLE_SHIFT) & Cst816Limits.HIGH_NIBBLE_MASK : 0;
      case Registers.X_LOW:
        return this.finger ? this.finger.x & Cst816Limits.LOW_BYTE_MASK : 0;
      case Registers.Y_HIGH:
        return this.finger ? (this.finger.y >> Cst816Limits.HIGH_NIBBLE_SHIFT) & Cst816Limits.HIGH_NIBBLE_MASK : 0;
      case Registers.Y_LOW:
        return this.finger ? this.finger.y & Cst816Limits.LOW_BYTE_MASK : 0;
      case Registers.CHIP_ID:
        return Cst816Identity.CHIP_ID;
      case Registers.FIRMWARE_VERSION:
        return Cst816Identity.FIRMWARE_VERSION;
      case Registers.FACTORY_ID:
        return Cst816Identity.FACTORY_ID;
      default:
        return this.written.get(register) ?? 0;
    }
  }

  private requireFits(args: { axis: "x" | "y"; value: number }): void {
    if (!Number.isInteger(args.value) || args.value < 0 || args.value >= Cst816Limits.POSITION_LIMIT) throw new Cst816PositionRefused(args);
  }
}
