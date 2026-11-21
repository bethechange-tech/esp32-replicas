import type { BoardDeclaration, BoardReplica, EmulatorEngine, EngineInput, FlashImage, GuestRadio, NetworkFrame, WifiSpec } from "@replicas/core";
import type { NetworkRelay } from "./network-relay";

const MILLISECONDS_PER_SECOND = 1000;
const SLICE_CYCLES = 2_000_000;

export type RunEngine = EmulatorEngine & GuestRadio & { cpuHertz(): number };

export interface StartPlan {
  readonly image: FlashImage;
  readonly wifiAccessPoint: WifiSpec;
  /** Extra regions to write into flash before boot, for example a data partition's contents. */
  readonly flashWrites: readonly FlashImage[];
}

/** One board run on fixed emulated time: slices of cycles, the network relay pumped between them, nothing read from a wall clock. */
export class BoardRun {
  private elapsedCycles = 0;
  private consoleText = "";
  private readonly networkLog: NetworkFrame[] = [];

  constructor(
    private readonly parts: {
      readonly engine: RunEngine;
      readonly board: BoardReplica;
      readonly declaration: BoardDeclaration;
      readonly relay: NetworkRelay;
      readonly startUnixMilliseconds: number;
    },
  ) {}

  async start(plan: StartPlan): Promise<void> {
    const { engine } = this.parts;
    await engine.create(this.parts.declaration);
    engine.load(plan.image);
    for (const write of plan.flashWrites) engine.load(write);
    engine.attachWifi(plan.wifiAccessPoint);
    engine.boot();
  }

  /** Runs this many emulated milliseconds. */
  async runFor(milliseconds: number): Promise<void> {
    const { engine } = this.parts;
    const slices = Math.ceil((milliseconds * engine.cpuHertz()) / MILLISECONDS_PER_SECOND / SLICE_CYCLES);
    for (let index = 0; index < slices; index += 1) {
      engine.run({ cycles: SLICE_CYCLES, unixMilliseconds: this.unixMilliseconds() });
      this.elapsedCycles += SLICE_CYCLES;
      this.consoleText += engine.takeOutput().console;
      this.networkLog.push(...engine.takeNetworkFrames());
      await this.parts.relay.pump();
    }
  }

  /** Runs in slices until the console holds the text, or the emulated time given is up; returns whether it appeared. */
  async runUntilConsole(args: { text: string; withinMilliseconds: number }): Promise<boolean> {
    const step = Math.ceil((SLICE_CYCLES * MILLISECONDS_PER_SECOND) / this.parts.engine.cpuHertz());
    for (let spent = 0; spent < args.withinMilliseconds; spent += step) {
      if (this.consoleText.includes(args.text)) return true;
      await this.runFor(step);
    }
    return this.consoleText.includes(args.text);
  }

  send(input: EngineInput): void {
    this.parts.engine.sendInput(input);
  }

  console(): string {
    return this.consoleText;
  }

  networkFrames(): readonly NetworkFrame[] {
    return this.networkLog;
  }

  emulatedMilliseconds(): number {
    return (this.elapsedCycles / this.parts.engine.cpuHertz()) * MILLISECONDS_PER_SECOND;
  }

  private unixMilliseconds(): number {
    return this.parts.startUnixMilliseconds + this.emulatedMilliseconds();
  }
}
