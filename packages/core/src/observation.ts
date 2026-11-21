export interface GpioEdge {
  readonly gpio: number;
  readonly level: boolean;
  readonly atCycle: number;
}

export interface SpiTransaction {
  readonly host: number;
  readonly mosi: Uint8Array;
  /** Bytes the firmware clocks in; the replica answers with at most this many. */
  readonly readLength: number;
  /** The level of the board's data/command pin at the moment of this transaction. */
  readonly dataCommandLevel: boolean;
}

export type I2cOperation =
  | { readonly kind: "start"; readonly bus: number; readonly address: number; readonly read: boolean }
  | { readonly kind: "write"; readonly bus: number; readonly byte: number }
  | { readonly kind: "read"; readonly bus: number }
  | { readonly kind: "stop"; readonly bus: number };

export interface UartByte {
  readonly uart: number;
  readonly byte: number;
}

export interface LcdFrame {
  readonly width: number;
  readonly height: number;
  readonly rgb565: Uint8Array;
}

export interface Observation {
  /** Console text as the firmware wrote it, line endings included, since the last take. */
  readonly console: string;
  readonly frames: readonly LcdFrame[];
  readonly gpioEdges: readonly GpioEdge[];
}
