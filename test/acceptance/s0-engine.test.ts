import { describe, expect, it } from "vitest";
import { RecordingBoardReplica } from "../fakes/recording-board-replica";
import { RomDownloadFrames } from "./support/rom-download-frames";
import { S0EngineHarness } from "./support/s0-engine-harness";
import { S0Fixtures } from "./support/s0-fixtures";

describe.skipIf(!S0Fixtures.engineReady())("the engine through TypeScript (needs build/esp32sim.wasm and build/roms)", () => {
  describe("hello world boots through the TypeScript host (AC0b.3)", () => {
    it.each(S0EngineHarness.chips())("%s: the console equals upstream's golden, byte for byte", async (chip) => {
      const engine = S0EngineHarness.engine(new RecordingBoardReplica());
      await S0EngineHarness.boot({ engine, declaration: S0Fixtures.declaration(chip), image: S0Fixtures.helloImage(chip) });
      const console = S0EngineHarness.runConsole({ engine, seconds: S0Fixtures.CONSOLE_SECONDS });
      expect(console).toBe(S0Fixtures.helloGolden(chip));
      expect(console).toContain("Hello world!");
    });

    it("is repeatable: a second run of the same image prints the same console", async () => {
      const runs = await Promise.all(
        [0, 1].map(async () => {
          const engine = S0EngineHarness.engine(new RecordingBoardReplica());
          await S0EngineHarness.boot({ engine, declaration: S0Fixtures.declaration("esp32s3"), image: S0Fixtures.helloImage("esp32s3") });
          return S0EngineHarness.runConsole({ engine, seconds: 1 });
        }),
      );
      expect(runs[0]).toBe(runs[1]);
      expect(runs[0]?.length).toBeGreaterThan(0);
    });
  });

  describe("console bytes arrive unchanged (AC0b.5)", () => {
    it("the mask ROM in download mode accepts a 256-byte block of every value 0x00 to 0xFF, checksum and all, and refuses it with one byte changed", async () => {
      const every = Uint8Array.from({ length: 256 }, (_, value) => value);
      const send = async (sent: Uint8Array): Promise<string> => {
        const engine = S0EngineHarness.engine(new RecordingBoardReplica());
        await engine.create(S0Fixtures.declaration("esp32s3"));
        engine.sendInput({ kind: "strap", value: 0 });
        engine.boot();
        S0EngineHarness.runConsole({ engine, seconds: 0.3 });
        const frames = [RomDownloadFrames.sync(), RomDownloadFrames.memoryBegin(every.length), RomDownloadFrames.memoryData({ declared: every, sent })];
        let reply = "";
        for (const frame of frames) {
          engine.sendInput({ kind: "console", bytes: frame });
          reply = S0EngineHarness.runConsole({ engine, seconds: 0.2 });
        }
        return reply;
      };
      const damaged = Uint8Array.from(every);
      damaged[200] = 0x7f;
      expect(RomDownloadFrames.isSuccess(await send(every))).toBe(true);
      expect(RomDownloadFrames.isChecksumFailure(await send(damaged))).toBe(true);
      expect(RomDownloadFrames.isChecksumFailure(await send(every))).toBe(false);
    });

    it("sends every byte value as lossless hex on the engine's byte-exact message", async () => {
      const sent: string[] = [];
      const engine = S0EngineHarness.engine(new RecordingBoardReplica());
      await engine.create(S0Fixtures.declaration("esp32s3"));
      const original = JSON.stringify;
      JSON.stringify = (value: unknown, ...rest: never[]): string => {
        sent.push(original(value, ...rest));
        return original(value, ...rest);
      };
      try {
        engine.sendInput({ kind: "console", bytes: Uint8Array.from({ length: 256 }, (_, value) => value) });
      } finally {
        JSON.stringify = original;
      }
      const message = JSON.parse(sent.at(-1) ?? "{}") as { t: string; hex: string; src: string };
      expect(message.t).toBe("bytes");
      expect(message.src).toBe("uart0");
      expect(message.hex).toBe(Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0")).join(""));
    });
  });
});