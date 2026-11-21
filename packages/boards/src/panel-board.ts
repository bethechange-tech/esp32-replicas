import {
  FactLookup,
  type BoardDeclaration,
  type BoardFacts,
  type BoardReplica,
  type I2cDevice,
  type I2cOperation,
  type LcdFrame,
} from "@replicas/core";
import type { BacklightHelper, Gt911, Gt911Point, RgbFrame } from "@replicas/devices";

export interface PanelDevices {
  readonly display: RgbFrame;
  readonly backlight: BacklightHelper;
  readonly touch: Gt911;
}

/** The 7 inch parallel-RGB panel board, assembled from its facts and devices. It holds no pin: every number is a fact. */
export class PanelBoard implements BoardReplica {
  private selected: I2cDevice | undefined;

  constructor(
    private readonly parts: {
      readonly facts: BoardFacts;
      readonly devices: PanelDevices;
    },
  ) {}

  /** What the engine must hand this board: the two I2C addresses and the LCD frames; no SPI and no UART to the host. */
  declaration(): BoardDeclaration {
    const { facts } = this.parts;
    return {
      chip: facts.chip.value,
      flashBytes: facts.flashBytes.value,
      psramBytes: facts.psramBytes.value,
      i2cAddresses: this.i2cDevices().map((device) => ({ bus: FactLookup.number({ facts, name: "i2c-bus" }), address: device.address })),
      routesSpiToHost: false,
      routesUartToHost: false,
      routesLcdToHost: true,
    };
  }

  onGpio(): void {}

  onSpi(): Uint8Array {
    return new Uint8Array(0);
  }

  onI2c(operation: I2cOperation): number | boolean | undefined {
    switch (operation.kind) {
      case "start":
        return this.startI2c({ address: operation.address, read: operation.read });
      case "write":
        return this.selected?.write(operation.byte) ?? false;
      case "read":
        return this.selected?.read();
      case "stop":
        this.selected?.stop();
        this.selected = undefined;
        return undefined;
    }
  }

  onUart(): void {}

  onLcdFrame(frame: LcdFrame): void {
    this.parts.devices.display.receive(frame);
  }

  /** What the glass shows: black until the backlight helper has been told to light it, then the latest frame the firmware scanned out. */
  frame(): LcdFrame | undefined {
    const { display, backlight } = this.parts.devices;
    return backlight.isOn() ? display.latest() : display.dark();
  }

  report(): Readonly<Record<string, string | number | boolean>> {
    const { display, backlight, touch } = this.parts.devices;
    return {
      "backlight-on": backlight.isOn(),
      "backlight-bytes": backlight.bytesReceived(),
      "display-frames": display.framesAccepted(),
      "display-frames-refused": display.framesRefused(),
      "touch-held": touch.isTouched(),
    };
  }

  /** A finger lands at this point; the firmware finds it on its next poll of the controller. */
  fingerDown(point: Gt911Point): void {
    this.parts.devices.touch.place(point);
  }

  fingerUp(): void {
    this.parts.devices.touch.lift();
  }

  private i2cDevices(): readonly I2cDevice[] {
    return [this.parts.devices.backlight, this.parts.devices.touch];
  }

  private startI2c(args: { address: number; read: boolean }): boolean {
    const device = this.i2cDevices().find((candidate) => candidate.address === args.address);
    if (!device) {
      this.selected = undefined;
      return false;
    }
    this.selected = device;
    device.start({ read: args.read });
    return true;
  }
}
