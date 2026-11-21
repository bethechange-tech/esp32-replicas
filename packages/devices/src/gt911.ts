import type { I2cDevice } from "@replicas/core";

/**
 * Registers and bits as the touch driver uses them (esphome/components/gt911/touchscreen/gt911_touchscreen.cpp at tag 2026.10.2:
 * https://github.com/esphome/esphome/blob/2026.10.2/esphome/components/gt911/touchscreen/gt911_touchscreen.cpp).
 * Every register is addressed by two bytes, high first.
 */
class Registers {
  /** GET_MAX_VALUES: x then y maximum, each two bytes low first. */
  static readonly MAX_VALUES = 0x8048;
  /** GET_SWITCHES: bit 0 set means the interrupt is active low. */
  static readonly SWITCHES = 0x804d;
  /** GET_TOUCH_STATE and CLEAR_TOUCH_STATE: bit 7 is "data ready", bits 0 to 2 the number of touches. */
  static readonly TOUCH_STATE = 0x814e;
  /** GET_TOUCHES: eight bytes per touch (id, x low, x high, y low, y high, size low, size high, one reserved), then the key byte. */
  static readonly TOUCHES = 0x814f;

  private constructor() {}
}

export class Gt911Layout {
  static readonly ADDRESS_BYTES = 2;
  static readonly ADDRESS_HIGH_SHIFT = 8;
  static readonly REGISTER_SPACE = 0x10000;
  static readonly DATA_READY = 0x80;
  static readonly ONE_TOUCH = 0x01;
  static readonly INTERRUPT_ACTIVE_LOW = 0x01;
  static readonly TOUCH_RECORD_BYTES = 8;
  static readonly TRACK_ID = 0;
  static readonly BYTE_BITS = 8;
  static readonly BYTE_MASK = 0xff;
  static readonly SIZE_LOW = 0x20;
  static readonly MAX_X_LOW_OFFSET = 0;
  static readonly MAX_X_HIGH_OFFSET = 1;
  static readonly MAX_Y_LOW_OFFSET = 2;
  static readonly MAX_Y_HIGH_OFFSET = 3;
  static readonly X_LOW_OFFSET = 1;
  static readonly X_HIGH_OFFSET = 2;
  static readonly Y_LOW_OFFSET = 3;
  static readonly Y_HIGH_OFFSET = 4;
  static readonly SIZE_LOW_OFFSET = 5;

  private constructor() {}
}

export class Gt911PositionRefused extends Error {
  constructor(args: { axis: "x" | "y"; value: number; limit: number }) {
    super(`touch ${args.axis} ${args.value} is outside 0 to ${args.limit - 1}`);
  }
}

export interface Gt911Wiring {
  readonly address: number;
  /** The panel's size in pixels: what the controller reports as its maximum position. */
  readonly columns: number;
  readonly rows: number;
}

export interface Gt911Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The GT911 touch controller, polled over I2C (the sample wires no interrupt pin). A finger is one touch: while it is down the status
 * register reads "one touch ready"; after it lifts the status reads "ready, no touch" once, so the driver sees the release.
 */
export class Gt911 implements I2cDevice {
  private readonly written = new Map<number, number>();
  private pointer = 0;
  private writeIndex = 0;
  private finger: Gt911Point | undefined;
  private releasePending = false;

  constructor(private readonly wiring: Gt911Wiring) {}

  get address(): number {
    return this.wiring.address;
  }

  place(point: Gt911Point): void {
    this.requireWithin({ axis: "x", value: point.x, limit: this.wiring.columns });
    this.requireWithin({ axis: "y", value: point.y, limit: this.wiring.rows });
    this.finger = point;
    this.releasePending = false;
  }

  lift(): void {
    if (this.finger) this.releasePending = true;
    this.finger = undefined;
  }

  isTouched(): boolean {
    return this.finger !== undefined;
  }

  start(args: { read: boolean }): void {
    if (!args.read) this.writeIndex = 0;
  }

  write(byte: number): boolean {
    if (this.writeIndex === 0) this.pointer = byte << Gt911Layout.ADDRESS_HIGH_SHIFT;
    else if (this.writeIndex === 1) this.pointer |= byte;
    else this.store(byte);
    this.writeIndex += 1;
    return true;
  }

  read(): number {
    return this.value(this.advance());
  }

  stop(): void {
    this.writeIndex = 0;
  }

  private store(byte: number): void {
    const register = this.advance();
    if (register === Registers.TOUCH_STATE && (byte & Gt911Layout.DATA_READY) === 0) this.releasePending = false;
    this.written.set(register, byte);
  }

  private advance(): number {
    const register = this.pointer;
    this.pointer = (this.pointer + 1) % Gt911Layout.REGISTER_SPACE;
    return register;
  }

  private value(register: number): number {
    switch (register) {
      case Registers.SWITCHES:
        return Gt911Layout.INTERRUPT_ACTIVE_LOW;
      case Registers.TOUCH_STATE:
        return this.status();
      default:
        return this.maxByte(register) ?? this.touchByte(register) ?? this.written.get(register) ?? 0;
    }
  }

  private status(): number {
    if (this.finger) return Gt911Layout.DATA_READY | Gt911Layout.ONE_TOUCH;
    return this.releasePending ? Gt911Layout.DATA_READY : 0;
  }

  private maxByte(register: number): number | undefined {
    switch (register - Registers.MAX_VALUES) {
      case Gt911Layout.MAX_X_LOW_OFFSET:
        return this.wiring.columns & Gt911Layout.BYTE_MASK;
      case Gt911Layout.MAX_X_HIGH_OFFSET:
        return this.wiring.columns >> Gt911Layout.BYTE_BITS;
      case Gt911Layout.MAX_Y_LOW_OFFSET:
        return this.wiring.rows & Gt911Layout.BYTE_MASK;
      case Gt911Layout.MAX_Y_HIGH_OFFSET:
        return this.wiring.rows >> Gt911Layout.BYTE_BITS;
      default:
        return undefined;
    }
  }

  private touchByte(register: number): number | undefined {
    const offset = register - Registers.TOUCHES;
    if (!this.finger || offset < 0 || offset >= Gt911Layout.TOUCH_RECORD_BYTES) return undefined;
    switch (offset) {
      case Gt911Layout.X_LOW_OFFSET:
        return this.finger.x & Gt911Layout.BYTE_MASK;
      case Gt911Layout.X_HIGH_OFFSET:
        return this.finger.x >> Gt911Layout.BYTE_BITS;
      case Gt911Layout.Y_LOW_OFFSET:
        return this.finger.y & Gt911Layout.BYTE_MASK;
      case Gt911Layout.Y_HIGH_OFFSET:
        return this.finger.y >> Gt911Layout.BYTE_BITS;
      case Gt911Layout.SIZE_LOW_OFFSET:
        return Gt911Layout.SIZE_LOW;
      default:
        return Gt911Layout.TRACK_ID;
    }
  }

  private requireWithin(args: { axis: "x" | "y"; value: number; limit: number }): void {
    if (!Number.isInteger(args.value) || args.value < 0 || args.value >= args.limit) throw new Gt911PositionRefused(args);
  }
}
