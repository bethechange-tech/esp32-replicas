import type { I2cDevice } from "@replicas/core";

export interface BacklightHelperWiring {
  readonly address: number;
  /** The byte that switches the backlight on. */
  readonly onCommand: number;
}

/** The helper chip that switches the panel's backlight: dark until it is sent the on command, and it acknowledges every other byte without effect. */
export class BacklightHelper implements I2cDevice {
  private lit = false;
  private sent = 0;

  constructor(private readonly wiring: BacklightHelperWiring) {}

  get address(): number {
    return this.wiring.address;
  }

  isOn(): boolean {
    return this.lit;
  }

  /** How many bytes the firmware has sent it. */
  bytesReceived(): number {
    return this.sent;
  }

  start(): void {}

  write(byte: number): boolean {
    this.sent += 1;
    if (byte === this.wiring.onCommand) this.lit = true;
    return true;
  }

  read(): number {
    return 0;
  }

  stop(): void {}
}
