import type { I2cDevice } from "@replicas/core";
import { UnitArithmetic } from "./unit-arithmetic";

/** Register map, reset values and least-significant bits from the TI INA226 datasheet (SBOS547A), tables 1 and 2. */
class Registers {
  static readonly CONFIGURATION = 0x00;
  static readonly SHUNT_VOLTAGE = 0x01;
  static readonly BUS_VOLTAGE = 0x02;
  static readonly POWER = 0x03;
  static readonly CURRENT = 0x04;
  static readonly CALIBRATION = 0x05;
  static readonly MASK_ENABLE = 0x06;
  static readonly ALERT_LIMIT = 0x07;
  static readonly MANUFACTURER_ID = 0xfe;
  static readonly DIE_ID = 0xff;
  static readonly CONFIGURATION_RESET_VALUE = 0x4127;
  static readonly RESET_BIT = 0x8000;
  static readonly MANUFACTURER_VALUE = 0x5449;
  static readonly DIE_VALUE = 0x2260;

  private constructor() {}
}

export class Ina226Units {
  /** Bus voltage register: 1.25 mV per count. */
  static readonly BUS_LSB_VOLTS = "0.00125";
  /** Shunt voltage register: 2.5 uV per count. */
  static readonly SHUNT_LSB_VOLTS = "0.0000025";
  /** Current register = shunt register x calibration / 2048. */
  static readonly CURRENT_DIVISOR = 2048;
  /** Power register = current register x bus register / 20000. */
  static readonly POWER_DIVISOR = 20_000;

  private constructor() {}
}

const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
const WORD_BYTES = 2;
const WORD_RANGE = 0x10000;
const SIGN_THRESHOLD = 0x8000;

/** The INA226 current and voltage monitor's register protocol, answering what the firmware writes and reads. */
export class Ina226 implements I2cDevice {
  private readonly registers = new Map<number, number>();
  private pointer = Registers.CONFIGURATION;
  private writeIndex = 0;
  private pendingHigh = 0;
  private readIndex = 0;
  private busCounts = 0;
  private shuntCounts = 0;

  constructor(readonly address: number) {
    this.reset();
  }

  setBusVolts(volts: number): void {
    this.busCounts = UnitArithmetic.counts({ volts, lsbVolts: Ina226Units.BUS_LSB_VOLTS });
  }

  setShuntVolts(volts: number): void {
    this.shuntCounts = UnitArithmetic.twosComplement16(UnitArithmetic.counts({ volts, lsbVolts: Ina226Units.SHUNT_LSB_VOLTS }));
  }

  start(args: { read: boolean }): void {
    this.writeIndex = 0;
    if (args.read) this.readIndex = 0;
  }

  write(byte: number): boolean {
    if (this.writeIndex === 0) this.pointer = byte;
    else if (this.writeIndex === 1) this.pendingHigh = byte;
    else if (this.writeIndex === WORD_BYTES) this.store({ register: this.pointer, value: (this.pendingHigh << BYTE_BITS) | byte });
    this.writeIndex += 1;
    return true;
  }

  read(): number {
    const value = this.value(this.pointer);
    const byte = this.readIndex === 0 ? value >> BYTE_BITS : value & BYTE_MASK;
    this.readIndex = (this.readIndex + 1) % WORD_BYTES;
    return byte;
  }

  stop(): void {
    this.writeIndex = 0;
  }

  private reset(): void {
    this.registers.clear();
    this.registers.set(Registers.CONFIGURATION, Registers.CONFIGURATION_RESET_VALUE);
  }

  private store(args: { register: number; value: number }): void {
    if (args.register === Registers.CONFIGURATION && (args.value & Registers.RESET_BIT) !== 0) {
      this.reset();
      return;
    }
    this.registers.set(args.register, args.value);
  }

  private value(register: number): number {
    switch (register) {
      case Registers.SHUNT_VOLTAGE:
        return this.shuntCounts;
      case Registers.BUS_VOLTAGE:
        return this.busCounts;
      case Registers.CURRENT:
        return this.current();
      case Registers.POWER:
        return Math.trunc((this.current() * this.busCounts) / Ina226Units.POWER_DIVISOR);
      case Registers.MANUFACTURER_ID:
        return Registers.MANUFACTURER_VALUE;
      case Registers.DIE_ID:
        return Registers.DIE_VALUE;
      default:
        return this.registers.get(register) ?? 0;
    }
  }

  private current(): number {
    const calibration = this.registers.get(Registers.CALIBRATION) ?? 0;
    return UnitArithmetic.twosComplement16(Math.trunc((this.signedShunt() * calibration) / Ina226Units.CURRENT_DIVISOR));
  }

  private signedShunt(): number {
    return this.shuntCounts >= SIGN_THRESHOLD ? this.shuntCounts - WORD_RANGE : this.shuntCounts;
  }
}
