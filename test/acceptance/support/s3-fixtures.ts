import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Composition, type PanelRun } from "@replicas/cli";
import type { FlashImage, GuestNetwork, LcdFrame } from "@replicas/core";
import { OfflineNetwork } from "@replicas/network";
import { RepositoryRoot } from "../../guards/support/temp-tree";
import { S0Fixtures } from "./s0-fixtures";
import { S1Fixtures } from "./s1-fixtures";

const SAMPLE = "build/samples/panel-7";
const GOLDENS = "test/goldens/panel-7";
const PREVIEWS = "build/goldens-preview/panel-7";
const POLL_MILLISECONDS = 250;

export type PanelStarted = PanelRun & { frame: () => LcdFrame };

/** What the panel-7 acceptance tests stand on: the built sample, its goldens and a started board. */
export class S3Fixtures {
  private constructor() {}

  static samplePath(): string {
    return path.join(RepositoryRoot.PATH, SAMPLE, "factory.bin");
  }

  /** The display model table as the locked ESPHome image holds it, copied out by tools/build-samples.sh. */
  static displayModelPath(): string {
    return path.join(RepositoryRoot.PATH, SAMPLE, "display-model.py");
  }

  static ready(): boolean {
    return S0Fixtures.engineReady() && existsSync(S3Fixtures.samplePath());
  }

  static image(): FlashImage {
    return { bytes: new Uint8Array(readFileSync(S3Fixtures.samplePath())), offset: 0 };
  }

  static golden(name: string): Uint8Array {
    return new Uint8Array(Buffer.from(readFileSync(path.join(RepositoryRoot.PATH, GOLDENS, `${name}.png.base64`), "utf8"), "base64"));
  }

  static preview(args: { name: string; png: Uint8Array }): void {
    const directory = path.join(RepositoryRoot.PATH, PREVIEWS);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `${args.name}.png`), args.png);
  }

  static compose(network: GuestNetwork): PanelRun {
    return Composition.panel({
      wasm: S0Fixtures.wasm(),
      romDirectory: S0Fixtures.romDirectory(),
      factsPath: S1Fixtures.factsPath(),
      network,
      log: { write: () => undefined },
      startUnixMilliseconds: S1Fixtures.START_UNIX_MILLISECONDS,
    });
  }

  static async start(args: { composed: PanelRun; caPem?: string }): Promise<void> {
    const image = S3Fixtures.image();
    const flashWrites = args.caPem ? [S1Fixtures.caWrite({ image, caPem: args.caPem })] : [];
    await args.composed.run.start({ image, wifiAccessPoint: S1Fixtures.WIFI, flashWrites });
  }

  /** A board started on an offline network with the sample, run for the milliseconds given. */
  static async booted(milliseconds: number): Promise<PanelStarted> {
    const composed = S3Fixtures.compose(new OfflineNetwork());
    await S3Fixtures.start({ composed });
    await composed.run.runFor(milliseconds);
    return {
      ...composed,
      frame: () => {
        const frame = composed.board.frame();
        if (!frame) throw new Error("the display shows nothing");
        return frame;
      },
    };
  }

  /** Runs in slices until the condition holds or the emulated time given is up; returns whether it held. */
  static async until(args: { composed: PanelRun; holds: () => boolean; withinMilliseconds: number }): Promise<boolean> {
    for (let spent = 0; spent < args.withinMilliseconds; spent += POLL_MILLISECONDS) {
      if (args.holds()) return true;
      await args.composed.run.runFor(POLL_MILLISECONDS);
    }
    return args.holds();
  }
}
