import {
  FactLookup,
  type BoardDeclaration,
  type BoardFacts,
  type BoardReplica,
  type EngineInput,
  type GpioEdge,
  type I2cDevice,
  type I2cOperation,
  type LcdFrame,
  type SpiTransaction,
} from "@replicas/core";
import { UnitArithmetic, type DcsPanel, type Ina226, type LineSource, type PowerLatch } from "@replicas/devices";

export interface SmallScreenDevices {
  readonly panel: DcsPanel;
  readonly currentMonitor: Ina226;
  readonly powerLatch: PowerLatch;
  readonly line: LineSource;
}

/** The 1.69 inch screen board, assembled from its facts and devices. It holds no pin: every number is a fact. */
export class SmallScreenBoard implements BoardReplica {
  private readonly gpioLevels = new Map<number, boolean>();
  private selected: I2cDevice | undefined;

  constructor(
    private readonly facts: BoardFacts,
    private readonly devices: SmallScreenDevices,
  ) {}

  /** What the engine must hand this board: its I2C address, the SPI display and the pin that tells commands from data. */
  declaration(): BoardDeclaration {
    return {
      chip: this.facts.chip.value,
      flashBytes: this.facts.flashBytes.value,
      psramBytes: this.facts.psramBytes.value,
      i2cAddresses: [{ bus: FactLookup.number({ facts: this.facts, name: "i2c-bus" }), address: FactLookup.number({ facts: this.facts, name: "current-monitor-address" }) }],
      routesSpiToHost: true,
      routesUartToHost: true,
      routesLcdToHost: false,
      dataCommandGpio: FactLookup.pin({ facts: this.facts, name: "display-data-command" }),
    };
  }

  onGpio(edges: readonly GpioEdge[]): void {
    this.devices.powerLatch.onEdges(edges);
    for (const edge of edges) this.gpioLevels.set(edge.gpio, edge.level);
  }

  onSpi(transaction: SpiTransaction): Uint8Array {
    return this.devices.panel.transfer(transaction);
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

  onLcdFrame(): void {}

  frame(): LcdFrame | undefined {
    return this.devices.panel.frame();
  }

  report(): Readonly<Record<string, string | number | boolean>> {
    return {
      "power-held": this.devices.powerLatch.holdsPower(),
      "display-showing": this.devices.panel.isShowing(),
      "display-writes": this.devices.panel.memoryWrites(),
    };
  }

  /** The voltage the current monitor's bus input sees. */
  monitorVolts(volts: number): void {
    this.devices.currentMonitor.setBusVolts(volts);
  }

  /** A battery at this voltage behind the divider: the input to give the engine for the sense pin. */
  packVolts(volts: number): EngineInput {
    return {
      kind: "adc",
      gpio: FactLookup.pin({ facts: this.facts, name: "battery-sense" }),
      volts: UnitArithmetic.dividedVolts({ volts, ratio: FactLookup.number({ facts: this.facts, name: "battery-divider-ratio" }) }),
    };
  }

  /** The text a serial line into the firmware's UART carries. */
  lineInput(text: string): EngineInput {
    return this.devices.line.input(text);
  }

  private startI2c(args: { address: number; read: boolean }): boolean {
    const device = this.devices.currentMonitor;
    if (args.address !== device.address) {
      this.selected = undefined;
      return false;
    }
    this.selected = device;
    device.start({ read: args.read });
    return true;
  }
}
