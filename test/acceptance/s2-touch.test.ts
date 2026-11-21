import { describe, expect, it } from "vitest";
import { Composition } from "@replicas/cli";
import { FactLookup } from "@replicas/core";
import { Cst816Identity } from "@replicas/devices";
import { FileBoardFacts } from "@replicas/firmware";
import { RecordingOutput } from "../fakes/recording-output";
import { RepositoryRoot } from "../guards/support/temp-tree";
import { PngEncoder } from "./support/png-encoder";
import { S1Fixtures } from "./support/s1-fixtures";
import { S2Fixtures, type TouchRun } from "./support/s2-fixtures";

const BOOT_MILLISECONDS = 3_000;
const TOUCH_HOLD_MILLISECONDS = 200;
const SETTLE_MILLISECONDS = 1_500;
const REBOOT_MILLISECONDS = 4_000;
const ROM_BANNER = "ESP-ROM:esp32s3";
const TAP_POINT = { x: 100, y: 120 };
const REPEATABILITY_RUNS = 3;
const STACK_TIMEOUT = 300_000;
const CLI_SECONDS = 3;
const FACTS = new FileBoardFacts(S1Fixtures.factsPath()).facts("small-screen-touch");
const INTERRUPT_GPIO = FactLookup.pin({ facts: FACTS, name: "touch-interrupt" });
const DRIVER_FAILURE = /Failed to read chip ID|Unknown chip ID|marked FAILED/;
const TOUCH_LOG = "touch at";

function png(booted: TouchRun): Buffer {
  return Buffer.from(PngEncoder.encode(booted.frame()));
}

function golden(name: string): Buffer {
  return Buffer.from(S2Fixtures.golden(name));
}

async function sendInOrder(args: { booted: TouchRun; inputs: ReturnType<TouchRun["board"]["fingerDown"]> }): Promise<void> {
  for (const input of args.inputs) args.booted.run.send(input);
  await args.booted.run.runFor(TOUCH_HOLD_MILLISECONDS);
}

async function tap(booted: TouchRun): Promise<void> {
  await sendInOrder({ booted, inputs: booted.board.fingerDown(TAP_POINT) });
  await sendInOrder({ booted, inputs: booted.board.fingerUp() });
  await booted.run.runFor(SETTLE_MILLISECONDS);
}

describe.skipIf(!S2Fixtures.ready())("small-screen-touch (needs build/esp32sim.wasm, build/roms and build/samples from tools/build-samples.sh)", () => {
  describe("the sample matches its lock", () => {
    it("the factory.bin and firmware.elf SHA-256 equal samples.lock", () => {
      const sample = S1Fixtures.lock().samples["small-screen-touch"];
      expect(sample?.factorySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(S1Fixtures.sha256(S2Fixtures.samplePath())).toBe(sample?.factorySha256);
      expect(S1Fixtures.sha256(S2Fixtures.samplePath().replace("factory.bin", "firmware.elf"))).toBe(sample?.elfSha256);
    });
  });

  describe("the driver finds the controller (AC2.1)", () => {
    it("the driver reads the CST816T's chip ID, accepts it and enables motion interrupts; it never reports a failure", async () => {
      const booted = await S2Fixtures.booted(BOOT_MILLISECONDS);
      expect(booted.board.report()["touch-irq-control"]).toBe(Cst816Identity.IRQ_ENABLE_MOTION);
      expect(booted.run.console()).not.toMatch(DRIVER_FAILURE);
      expect(booted.run.console()).toContain("Project replica.small-screen-touch version 1.0.0");
    }, STACK_TIMEOUT);
  });

  describe("a tap shows the next page (AC2.2)", () => {
    it("INT pulses on GPIO14, and the frame goes from the first page's golden to the next page's, identically in three runs", async () => {
      const finals: Buffer[] = [];
      for (let attempt = 0; attempt < REPEATABILITY_RUNS; attempt += 1) {
        const booted = await S2Fixtures.booted(BOOT_MILLISECONDS);
        expect(png(booted).equals(golden("colour-bars"))).toBe(true);
        const down = booted.board.fingerDown(TAP_POINT);
        expect(down.map((input) => (input.kind === "gpio" ? [input.gpio, input.level] : []))).toEqual([true, false, true].map((level) => [INTERRUPT_GPIO, level]));
        await sendInOrder({ booted, inputs: down });
        expect(booted.run.console()).toContain(TOUCH_LOG);
        expect(png(booted).equals(golden("colour-bars"))).toBe(true);
        await sendInOrder({ booted, inputs: booted.board.fingerUp() });
        await booted.run.runFor(SETTLE_MILLISECONDS);
        S2Fixtures.preview({ name: "ruler", png: PngEncoder.encode(booted.frame()) });
        finals.push(png(booted));
      }
      expect(finals.every((final) => final.equals(golden("ruler")))).toBe(true);
      expect(golden("ruler").equals(golden("colour-bars"))).toBe(false);
    }, STACK_TIMEOUT);

    it("a second tap goes round to the first page again", async () => {
      const booted = await S2Fixtures.booted(BOOT_MILLISECONDS);
      await tap(booted);
      expect(png(booted).equals(golden("ruler"))).toBe(true);
      await tap(booted);
      expect(png(booted).equals(golden("colour-bars"))).toBe(true);
    }, STACK_TIMEOUT);

    it("a finger that rests on the glass with no INT pulse is not read: the page stays, and nothing is logged as a touch", async () => {
      const booted = await S2Fixtures.booted(BOOT_MILLISECONDS);
      booted.board.fingerRests(TAP_POINT);
      await booted.run.runFor(SETTLE_MILLISECONDS);
      expect(booted.board.report()["touch-held"]).toBe(true);
      expect(booted.run.console()).not.toContain(TOUCH_LOG);
      expect(png(booted).equals(golden("colour-bars"))).toBe(true);
    }, STACK_TIMEOUT);

    it("RST on GPIO13 clears a pending touch: after the firmware restarts and resets the controller, an INT pulse finds no touch", async () => {
      const booted = await S2Fixtures.booted(BOOT_MILLISECONDS);
      booted.board.fingerRests(TAP_POINT);
      expect(booted.board.report()["touch-held"]).toBe(true);
      booted.run.send(booted.board.lineInput("restart"));
      await booted.run.runFor(REBOOT_MILLISECONDS);
      expect(booted.run.console().split(ROM_BANNER)).toHaveLength(3);
      expect(booted.board.report()["touch-held"]).toBe(false);
      await sendInOrder({ booted, inputs: booted.board.fingerUp() });
      await booted.run.runFor(SETTLE_MILLISECONDS);
      expect(booted.run.console()).not.toContain(TOUCH_LOG);
      expect(png(booted).equals(golden("colour-bars"))).toBe(true);
    }, STACK_TIMEOUT);
  });

  describe("bring your own image", () => {
    it("`replica run --board small-screen-touch --image` boots the touch sample", async () => {
      const output = new RecordingOutput();
      const code = await Composition.cli({ root: RepositoryRoot.PATH, output }).execute(["run", "--board", "small-screen-touch", "--image", S2Fixtures.samplePath(), "--seconds", String(CLI_SECONDS)]);
      expect(code).toBe(0);
      expect(output.written()).toContain("Project replica.small-screen-touch version 1.0.0");
    }, STACK_TIMEOUT);
  });
});
