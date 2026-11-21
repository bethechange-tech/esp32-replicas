import type { GpioEdge, I2cOperation, LcdFrame, SpiTransaction, UartByte } from "../observation";

export interface I2cDevice {
  readonly address: number;
  /** A new transaction: a write starts at its first byte, a read continues from the register last pointed at. */
  start(args: { read: boolean }): void;
  write(byte: number): boolean;
  read(): number;
  stop(): void;
}

export interface SpiDevice {
  transfer(transaction: SpiTransaction): Uint8Array;
}

export interface GpioWatcher {
  onEdges(edges: readonly GpioEdge[]): void;
}

export interface UartEndpoint {
  receive(byte: UartByte): void;
  pendingBytes(): readonly UartByte[];
}

export interface Display {
  frame(): LcdFrame | undefined;
}

export interface BoardReplica {
  onGpio(edges: readonly GpioEdge[]): void;
  onSpi(transaction: SpiTransaction): Uint8Array;
  onI2c(operation: I2cOperation): number | boolean | undefined;
  onUart(byte: UartByte): void;
  onLcdFrame(frame: LcdFrame): void;
  frame(): LcdFrame | undefined;
  report(): Readonly<Record<string, string | number | boolean>>;
}
