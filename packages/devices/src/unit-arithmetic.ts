import Decimal from "decimal.js";

const DECIMAL_PRECISION = 40;
const REGISTER_BITS = 16;
const SIGN_BIT_MODULUS = 2 ** REGISTER_BITS;

/** Every unit conversion of a simulated quantity, in decimal. A number becomes a JS number only here, at the register or the pin. */
export class UnitArithmetic {
  private static readonly DECIMAL = Decimal.clone({ precision: DECIMAL_PRECISION, rounding: Decimal.ROUND_HALF_EVEN });

  private constructor() {}

  /** The register count of a voltage at a least-significant-bit size, rounded to the nearest count. */
  static counts(args: { volts: number; lsbVolts: string }): number {
    return new UnitArithmetic.DECIMAL(args.volts).div(args.lsbVolts).toDecimalPlaces(0).toNumber();
  }

  /** A signed count as the 16-bit two's complement a register holds. */
  static twosComplement16(counts: number): number {
    return ((counts % SIGN_BIT_MODULUS) + SIGN_BIT_MODULUS) % SIGN_BIT_MODULUS;
  }

  /** The voltage at a pin behind a divider whose ratio is input over output. */
  static dividedVolts(args: { volts: number; ratio: number }): number {
    return new UnitArithmetic.DECIMAL(args.volts).div(args.ratio).toNumber();
  }

  /** The current in amperes that a shunt voltage drives through a shunt resistance. */
  static amperes(args: { shuntVolts: string; ohms: number }): number {
    return new UnitArithmetic.DECIMAL(args.shuntVolts).div(args.ohms).toNumber();
  }
}
