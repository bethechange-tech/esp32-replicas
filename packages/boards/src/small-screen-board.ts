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
import { UnitArithmetic, type Cst816, type DcsPanel, type Ina226, type LineSource, type PowerLatch, type TouchPoint } from "@replicas/devices";

export interface SmallScreenDevices {
  readonly panel: DcsPanel;
  readonly currentMonitor: Ina226;
  readonly powerLatch: PowerLatch;
  readonly line: LineSource;
}

export class NoTouchController extends Error {
  constructor() {
    super("this board has no touch controller");
  }
}

/** The 1.69 inch screen board, assembled from its facts and devices. It holds no pin: every number is a fact. */
export class SmallScreenBoard implements BoardReplica {
  private readonly gpioLevels = new Map<number, boolean>();
  private selected: I2cDevice | undefined;

  private constructor(
    private readonly facts: BoardFacts,
    private readonly devices: SmallScreenDevices & { readonly touch: Cst816 | undefined },
  ) {}

  static withoutTouch(args: { facts: BoardFacts; devices: SmallScreenDevices }): SmallScreenBoard {
    return new SmallScreenBoard(args.facts, { ...args.devices, touch: undefined });
  }

  static withTouch(args: { facts: BoardFacts; devices: SmallScreenDevices; touch: Cst816 }): SmallScreenBoard {
    return new SmallScreenBoard(args.facts, { ...args.devices, touch: args.touch });
  }

  /** What the engine must hand this board: its I2C address, the SPI display and the pin that tells commands from data. */
  declaration(): BoardDeclaration {
    return {
      chip: this.facts.chip.value,
      flashBytes: this.facts.flashBytes.value,
      psramBytes: this.facts.psramBytes.value,
      i2cAddresses: this.i2cDevices().map((device) => ({ bus: FactLookup.number({ facts: this.facts, name: "i2c-bus" }), address: device.address })),
      routesSpiToHost: true,
      routesUartToHost: true,
      routesLcdToHost: false,
      dataCommandGpio: FactLookup.pin({ facts: this.facts, name: "display-data-command" }),
    };
  }

  onGpio(edges: readonly GpioEdge[]): void {
    this.devices.powerLatch.onEdges(edges);
    this.devices.touch?.onEdges(edges);
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
    const report = {
      "power-held": this.devices.powerLatch.holdsPower(),
      "display-showing": this.devices.panel.isShowing(),
      "display-writes": this.devices.panel.memoryWrites(),
    };
    return this.devices.touch ? { ...report, "touch-held": this.devices.touch.isTouched(), "touch-irq-control": this.devices.touch.irqControl() } : report;
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

  /** A finger lands at this point: the controller holds it and the returned inputs pulse INT, for the engine to be given in order. */
  fingerDown(point: TouchPoint): readonly EngineInput[] {
    const touch = this.controller();
    touch.place(point);
    return touch.interrupt();
  }

  /** The finger leaves: the controller reports no touch and the returned inputs pulse INT. */
  fingerUp(): readonly EngineInput[] {
    const touch = this.controller();
    touch.lift();
    return touch.interrupt();
  }

  /** A finger on the glass with no interrupt yet: the touch waits to be read. */
  fingerRests(point: TouchPoint): void {
    this.controller().place(point);
  }

  private controller(): Cst816 {
    if (!this.devices.touch) throw new NoTouchController();
    return this.devices.touch;
  }

  private i2cDevices(): readonly I2cDevice[] {
    return this.devices.touch ? [this.devices.currentMonitor, this.devices.touch] : [this.devices.currentMonitor];
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
