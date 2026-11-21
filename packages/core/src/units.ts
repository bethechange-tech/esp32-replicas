export interface Bounds {
  readonly min: number;
  readonly max: number;
}

export type Unit =
  | "volt"
  | "ampere"
  | "ohm"
  | "hertz"
  | "baud"
  | "pixel"
  | "byte"
  | "millisecond"
  | "ratio"
  | "gpio"
  | "i2c-address"
  | "none";

/** Bounds are data so that a test can assert the numbers themselves. */
export class UnitBounds {
  /** ESP32-S3 datasheet: GPIO0 to GPIO48. The classic ESP32 stops lower, so this is the wider of the two. */
  static readonly GPIO: Bounds = { min: 0, max: 48 };
  /** I2C specification: a 7-bit address. */
  static readonly I2C_ADDRESS: Bounds = { min: 0x00, max: 0x7f };
  /** Internal limit, no public source: a divider ratio is input over output, so at least 1 (1 is no division). */
  static readonly DIVIDER_RATIO: Bounds = { min: 1, max: 100 };
  /** Internal limit, no public source: the range the replicas accept for a UART line. */
  static readonly BAUD: Bounds = { min: 1200, max: 5_000_000 };
  /** Internal limit, no public source: the largest display edge the replicas accept. */
  static readonly PIXELS: Bounds = { min: 1, max: 4096 };

  private constructor() {}
}

export class BoundsCheck {
  private constructor() {}

  static contains(args: { bounds: Bounds; value: number }): boolean {
    return Number.isFinite(args.value) && args.value >= args.bounds.min && args.value <= args.bounds.max;
  }

  static refusal(args: { name: string; bounds: Bounds; value: number }): string | undefined {
    if (BoundsCheck.contains(args)) return undefined;
    return `${args.name} ${args.value} is outside ${args.bounds.min} to ${args.bounds.max}`;
  }
}
