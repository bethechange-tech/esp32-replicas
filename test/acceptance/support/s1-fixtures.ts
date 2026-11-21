import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Composition, type SmallScreenRun } from "@replicas/cli";
import type { FlashImage, GuestNetwork, LcdFrame } from "@replicas/core";
import { PartitionTable } from "@replicas/firmware";
import { OfflineNetwork } from "@replicas/network";
import { RepositoryRoot } from "../../guards/support/temp-tree";
import { S0Fixtures } from "./s0-fixtures";

const SAMPLE = "build/samples/small-screen";
const GOLDENS = "test/goldens/small-screen";
const PREVIEWS = "build/goldens-preview/small-screen";
const LOCK = "sample-firmware/samples.lock";
const FACTS = "facts/boards.json";
const CA_PARTITION = "replica_ca";
const NUL = 0;
const POLL_MILLISECONDS = 250;

export interface SmallScreenStart {
  readonly network: GuestNetwork;
  /** The certificate authority the harness writes into the `replica_ca` partition. */
  readonly caPem?: string;
}

/** What the small-screen acceptance tests stand on: the built sample, its lock, the goldens and a started board. */
export class S1Fixtures {
  static readonly START_UNIX_MILLISECONDS = S0Fixtures.START_UNIX_MILLISECONDS;
  static readonly WIFI = { ssid: "replica-lab", psk: "replica-lab-pass" } as const;
  static readonly BROKER_NAME = "broker.replica.test";

  private constructor() {}

  static samplePath(): string {
    return path.join(RepositoryRoot.PATH, SAMPLE, "factory.bin");
  }

  static factsPath(): string {
    return path.join(RepositoryRoot.PATH, FACTS);
  }

  /** The engine, the ROMs and the built sample are present; a checkout that has not built them skips these tests, and CI builds first. */
  static ready(): boolean {
    return S0Fixtures.engineReady() && existsSync(S1Fixtures.samplePath());
  }

  static image(): FlashImage {
    return { bytes: new Uint8Array(readFileSync(S1Fixtures.samplePath())), offset: 0 };
  }

  static lock(): { esphome: { version: string; image: string }; samples: Record<string, { factorySha256: string; elfSha256: string }> } {
    return JSON.parse(readFileSync(path.join(RepositoryRoot.PATH, LOCK), "utf8")) as ReturnType<typeof S1Fixtures.lock>;
  }

  static sha256(file: string): string {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  }

  /** A golden is kept as base64 text of its PNG, so that the privacy scan can read it; `preview` writes the PNG for a reviewer to open. */
  static golden(name: string): Uint8Array {
    return new Uint8Array(Buffer.from(readFileSync(path.join(RepositoryRoot.PATH, GOLDENS, `${name}.png.base64`), "utf8"), "base64"));
  }

  static preview(args: { name: string; png: Uint8Array }): void {
    const directory = path.join(RepositoryRoot.PATH, PREVIEWS);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `${args.name}.png`), args.png);
  }

  static compose(network: GuestNetwork): SmallScreenRun {
    return Composition.smallScreen({
      wasm: S0Fixtures.wasm(),
      romDirectory: S0Fixtures.romDirectory(),
      factsPath: S1Fixtures.factsPath(),
      network,
      log: { write: () => undefined },
      startUnixMilliseconds: S1Fixtures.START_UNIX_MILLISECONDS,
    });
  }

  static async start(args: { composed: SmallScreenRun; image?: FlashImage; caPem?: string }): Promise<void> {
    const image = args.image ?? S1Fixtures.image();
    await args.composed.run.start({ image, wifiAccessPoint: S1Fixtures.WIFI, flashWrites: args.caPem ? [S1Fixtures.caWrite({ image, caPem: args.caPem })] : [] });
  }

  /** A board started on an offline network with the sample, run for the milliseconds given. */
  static async booted(milliseconds: number): Promise<SmallScreenRun & { frame: () => LcdFrame }> {
    const composed = S1Fixtures.compose(new OfflineNetwork());
    await S1Fixtures.start({ composed });
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
  static async until(args: { composed: SmallScreenRun; holds: () => boolean; withinMilliseconds: number }): Promise<boolean> {
    for (let spent = 0; spent < args.withinMilliseconds; spent += POLL_MILLISECONDS) {
      if (args.holds()) return true;
      await args.composed.run.runFor(POLL_MILLISECONDS);
    }
    return args.holds();
  }

  private static caWrite(args: { image: FlashImage; caPem: string }): FlashImage {
    const place = PartitionTable.find({ image: args.image, name: CA_PARTITION });
    return { bytes: Uint8Array.from([...new TextEncoder().encode(args.caPem), NUL]), offset: place.offset };
  }
}
