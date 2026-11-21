import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Composition, type SmallScreenRun } from "@replicas/cli";
import type { FlashImage, LcdFrame } from "@replicas/core";
import { OfflineNetwork } from "@replicas/network";
import { RepositoryRoot } from "../../guards/support/temp-tree";
import { S0Fixtures } from "./s0-fixtures";
import { S1Fixtures } from "./s1-fixtures";

const SAMPLE = "build/samples/small-screen-touch";
const PREVIEWS = "build/goldens-preview/small-screen-touch";

export type TouchRun = SmallScreenRun & { frame: () => LcdFrame };

/** What the small-screen-touch acceptance tests stand on: the built sample, its goldens and a started board. */
export class S2Fixtures {
  private constructor() {}

  static samplePath(): string {
    return path.join(RepositoryRoot.PATH, SAMPLE, "factory.bin");
  }

  static ready(): boolean {
    return S0Fixtures.engineReady() && existsSync(S2Fixtures.samplePath());
  }

  static image(): FlashImage {
    return { bytes: new Uint8Array(readFileSync(S2Fixtures.samplePath())), offset: 0 };
  }

  /** The touch sample draws the screen small-screen's sample does, so the two boards share one set of goldens. */
  static golden(name: string): Uint8Array {
    return S1Fixtures.golden(name);
  }

  static preview(args: { name: string; png: Uint8Array }): void {
    const directory = path.join(RepositoryRoot.PATH, PREVIEWS);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `${args.name}.png`), args.png);
  }

  /** A touch board started on an offline network with the touch sample, run for the milliseconds given. */
  static async booted(milliseconds: number): Promise<TouchRun> {
    const composed = Composition.smallScreenTouch({
      wasm: S0Fixtures.wasm(),
      romDirectory: S0Fixtures.romDirectory(),
      factsPath: S1Fixtures.factsPath(),
      network: new OfflineNetwork(),
      log: { write: () => undefined },
      startUnixMilliseconds: S1Fixtures.START_UNIX_MILLISECONDS,
    });
    await composed.run.start({ image: S2Fixtures.image(), wifiAccessPoint: S1Fixtures.WIFI, flashWrites: [] });
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
}
