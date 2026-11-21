import type { I2cDevice } from "@replicas/core";

/** A device with a plain register file: the first byte of a write is the register, later bytes fill it, and reads walk upwards from it. */
export class RegisterFileI2cDevice implements I2cDevice {
  private readonly registers = new Map<number, number>();
  private pointer = 0;
  private writeIndex = 0;

  constructor(readonly address: number) {}

  start(args: { read: boolean }): void {
    if (!args.read) this.writeIndex = 0;
  }

  write(byte: number): boolean {
    if (this.writeIndex === 0) this.pointer = byte;
    else this.registers.set(this.pointer++, byte);
    this.writeIndex += 1;
    return true;
  }

  read(): number {
    return this.registers.get(this.pointer++) ?? 0;
  }

  stop(): void {
    this.writeIndex = 0;
  }
}
