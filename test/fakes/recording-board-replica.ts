import type { BoardReplica, GpioEdge, I2cOperation, LcdFrame, SpiTransaction, UartByte } from "@replicas/core";

/** A replica with no board in it: it records every event it is handed and answers from what it was given. */
export class RecordingBoardReplica implements BoardReplica {
  readonly gpio: GpioEdge[] = [];
  readonly spi: SpiTransaction[] = [];
  readonly i2c: I2cOperation[] = [];
  readonly uart: UartByte[] = [];
  readonly frames: LcdFrame[] = [];

  constructor(
    private readonly answers: {
      readonly i2cAddress?: number;
      readonly i2cReadByte?: number;
      readonly spiReply?: Uint8Array;
    } = {},
  ) {}

  onGpio(edges: readonly GpioEdge[]): void {
    this.gpio.push(...edges);
  }

  onSpi(transaction: SpiTransaction): Uint8Array {
    this.spi.push(transaction);
    return this.answers.spiReply ?? new Uint8Array(0);
  }

  onI2c(operation: I2cOperation): number | boolean | undefined {
    this.i2c.push(operation);
    if (operation.kind === "start") return operation.address === this.answers.i2cAddress;
    if (operation.kind === "write") return true;
    if (operation.kind === "read") return this.answers.i2cReadByte ?? 0;
    return undefined;
  }

  onUart(byte: UartByte): void {
    this.uart.push(byte);
  }

  onLcdFrame(frame: LcdFrame): void {
    this.frames.push(frame);
  }

  frame(): LcdFrame | undefined {
    return this.frames.at(-1);
  }

  report(): Readonly<Record<string, string | number | boolean>> {
    return { events: this.gpio.length + this.spi.length + this.i2c.length + this.uart.length };
  }
}
