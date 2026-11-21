import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Composition } from "@replicas/cli";
import { FactLookup } from "@replicas/core";
import { FileBoardFacts, TestCa } from "@replicas/firmware";
import { InProcessMqttBroker, NodeSocketNetwork } from "@replicas/network";
import { ImprovSerial } from "@replicas/setup";
import { FixedClock } from "../fakes/fixed-clock";
import { RecordingOutput } from "../fakes/recording-output";
import { RepositoryRoot } from "../guards/support/temp-tree";
import { DhcpFrames } from "./support/dhcp-frames";
import { PngEncoder } from "./support/png-encoder";
import { S1Fixtures } from "./support/s1-fixtures";
import { S3Fixtures, type PanelStarted } from "./support/s3-fixtures";

const PROJECT_LINE = "Project replica.panel-7 version 1.0.0";
const ROM_BANNER = "ESP-ROM:esp32s3";
const DARK_WINDOW_MILLISECONDS = 3_000;
const LIT_WINDOW_MILLISECONDS = 7_000;
const NO_RESET_WINDOW_MILLISECONDS = 20_000;
const NETWORK_WINDOW_MILLISECONDS = 60_000;
const BOOT_MILLISECONDS = 3_000;
const TOUCH_HOLD_MILLISECONDS = 200;
const SETTLE_MILLISECONDS = 1_500;
const TAP_POINT = { x: 100, y: 120 };
const RESTART_POINT = { x: 780, y: 460 };
const REPEATABILITY_RUNS = 3;
const MIN_COLOURS = 8;
const STACK_TIMEOUT = 300_000;
const CLI_SECONDS = 3;
const DHCP_ADDRESS = "10.0.2.15";
const TLS_VERIFY_FAILURE = "mbedtls_ssl_handshake returned -0x2700";
const TLS_UNKNOWN_CA = "unknown ca";
const STATUS_TOPIC = "replica/replica-panel-7/status";
const TOUCH_LOG = "touch at";
const DRIVER_FAILURE = /Calibration error|marked FAILED|Communication with GT911 failed/;
const FACTS = new FileBoardFacts(S1Fixtures.factsPath()).facts("panel-7");
const COLUMNS = FactLookup.number({ facts: FACTS, name: "display-visible-columns" });
const ROWS = FactLookup.number({ facts: FACTS, name: "display-visible-rows" });

function distinctColours(rgb565: Uint8Array): number {
  const seen = new Set<number>();
  for (let at = 0; at < rgb565.length; at += 2) seen.add(((rgb565[at] ?? 0) << 8) | (rgb565[at + 1] ?? 0));
  return seen.size;
}

function png(booted: PanelStarted): Buffer {
  return Buffer.from(PngEncoder.encode(booted.frame()));
}

function golden(name: string): Buffer {
  return Buffer.from(S3Fixtures.golden(name));
}

function announced(broker: InProcessMqttBroker): boolean {
  return broker.published.some((message) => message.topic === STATUS_TOPIC);
}

async function tap(args: { booted: PanelStarted; point: { x: number; y: number } }): Promise<void> {
  args.booted.board.fingerDown(args.point);
  await args.booted.run.runFor(TOUCH_HOLD_MILLISECONDS);
  args.booted.board.fingerUp();
  await args.booted.run.runFor(SETTLE_MILLISECONDS);
}

describe.skipIf(!S3Fixtures.ready())("panel-7 (needs build/esp32sim.wasm, build/roms and build/samples from tools/build-samples.sh)", () => {
  describe("the sample matches its lock", () => {
    it("the factory.bin and firmware.elf SHA-256 equal samples.lock", () => {
      const sample = S1Fixtures.lock().samples["panel-7"];
      expect(sample?.factorySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(S1Fixtures.sha256(S3Fixtures.samplePath())).toBe(sample?.factorySha256);
      expect(S1Fixtures.sha256(S3Fixtures.samplePath().replace("factory.bin", "firmware.elf"))).toBe(sample?.elfSha256);
    });
  });

  describe("boots (AC3.1)", () => {
    it("names the sample and version on UART0, does not reset in 20 emulated seconds, and scans a frame out of its PSRAM framebuffer", async () => {
      const { run, board } = await S3Fixtures.booted(NO_RESET_WINDOW_MILLISECONDS);
      expect(run.console()).toContain(PROJECT_LINE);
      expect(run.console().split(ROM_BANNER)).toHaveLength(2);
      expect(run.emulatedMilliseconds()).toBeGreaterThanOrEqual(NO_RESET_WINDOW_MILLISECONDS);
      expect(board.report()["display-frames"]).toBeGreaterThan(0);
      expect(board.report()["display-frames-refused"]).toBe(0);
      expect(run.console()).not.toMatch(DRIVER_FAILURE);
    }, STACK_TIMEOUT);
  });

  describe("the backlight helper lights the panel (AC3.2)", () => {
    it("the panel is black, with the firmware already drawing, until 0x10 reaches 0x30, and shows the page after", async () => {
      const booted = await S3Fixtures.booted(DARK_WINDOW_MILLISECONDS);
      expect(booted.board.report()["backlight-on"]).toBe(false);
      expect(booted.board.report()["backlight-bytes"]).toBe(0);
      expect(booted.board.report()["display-frames"]).toBeGreaterThan(0);
      expect(distinctColours(booted.frame().rgb565)).toBe(1);
      await booted.run.runFor(LIT_WINDOW_MILLISECONDS);
      expect(booted.board.report()["backlight-on"]).toBe(true);
      expect(booted.run.console()).toContain("helper told to light the panel");
      expect(distinctColours(booted.frame().rgb565)).toBeGreaterThanOrEqual(MIN_COLOURS);
    }, STACK_TIMEOUT);
  });

  describe("the screen matches its golden (AC3.2)", () => {
    it("is 800x480, upright, and bit-identical to the reviewed golden in three runs", async () => {
      const pngs: Buffer[] = [];
      for (let attempt = 0; attempt < REPEATABILITY_RUNS; attempt += 1) {
        const booted = await S3Fixtures.booted(DARK_WINDOW_MILLISECONDS + LIT_WINDOW_MILLISECONDS);
        const frame = booted.frame();
        expect([frame.width, frame.height]).toEqual([COLUMNS, ROWS]);
        pngs.push(png(booted));
        S3Fixtures.preview({ name: "colour-bars", png: PngEncoder.encode(frame) });
      }
      expect(pngs[1]?.equals(pngs[0] ?? Buffer.alloc(0))).toBe(true);
      expect(pngs[2]?.equals(pngs[0] ?? Buffer.alloc(0))).toBe(true);
      expect(pngs[0]?.equals(golden("colour-bars"))).toBe(true);
    }, STACK_TIMEOUT);
  });

  describe("a tap changes the screen (AC3.3)", () => {
    it("the driver calibrates from the controller, and a tap shows the next page, matching its golden, identically in three runs", async () => {
      for (let attempt = 0; attempt < REPEATABILITY_RUNS; attempt += 1) {
        const booted = await S3Fixtures.booted(DARK_WINDOW_MILLISECONDS + LIT_WINDOW_MILLISECONDS);
        expect(booted.run.console()).not.toMatch(DRIVER_FAILURE);
        expect(png(booted).equals(golden("colour-bars"))).toBe(true);
        await tap({ booted, point: TAP_POINT });
        expect(booted.run.console()).toContain(TOUCH_LOG);
        S3Fixtures.preview({ name: "ruler", png: PngEncoder.encode(booted.frame()) });
        expect(png(booted).equals(golden("ruler"))).toBe(true);
      }
      expect(golden("ruler").equals(golden("colour-bars"))).toBe(false);
    }, STACK_TIMEOUT);

    it("a finger that never lifts shows no new page, and lifting it does", async () => {
      const booted = await S3Fixtures.booted(DARK_WINDOW_MILLISECONDS + LIT_WINDOW_MILLISECONDS);
      booted.board.fingerDown(TAP_POINT);
      await booted.run.runFor(SETTLE_MILLISECONDS);
      expect(png(booted).equals(golden("colour-bars"))).toBe(true);
      booted.board.fingerUp();
      await booted.run.runFor(SETTLE_MILLISECONDS);
      expect(png(booted).equals(golden("ruler"))).toBe(true);
    }, STACK_TIMEOUT);
  });

  describe("wifi and mqtt (AC3.4)", () => {
    async function joined(args: { caPem: string | undefined; brokerAuthority: TestCa }) {
      const broker = await InProcessMqttBroker.serving(args.brokerAuthority);
      const address = await broker.listen();
      const composed = S3Fixtures.compose(new NodeSocketNetwork({ [S1Fixtures.BROKER_NAME]: address }));
      await S3Fixtures.start({ composed, ...(args.caPem === undefined ? {} : { caPem: args.caPem }) });
      await composed.run.runFor(BOOT_MILLISECONDS);
      composed.run.send({ kind: "console", bytes: new ImprovSerial().sendWifiSettings(S1Fixtures.WIFI) });
      return { broker, composed };
    }

    it("improv sets wifi, the DHCP ACK for 10.0.2.15 is on the wire, and after a restart the saved network is reused", async () => {
      const authority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const { broker, composed } = await joined({ caPem: authority.caPem, brokerAuthority: authority });
      const acknowledged = () => DhcpFrames.acknowledgedAddresses(composed.run.networkFrames());
      expect(await S3Fixtures.until({ composed, holds: () => acknowledged().length >= 1, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(acknowledged()[0]).toBe(DHCP_ADDRESS);
      expect(await S3Fixtures.until({ composed, holds: () => announced(broker), withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      composed.board.fingerDown(RESTART_POINT);
      expect(await S3Fixtures.until({ composed, holds: () => composed.run.console().split(ROM_BANNER).length >= 3, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      composed.board.fingerUp();
      expect(await S3Fixtures.until({ composed, holds: () => acknowledged().length >= 2, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(acknowledged()[1]).toBe(DHCP_ADDRESS);
      await broker.close();
    }, STACK_TIMEOUT);

    it("mqtt over tls: the SNI is broker.replica.test, CONNECT and one publish reach the broker", async () => {
      const authority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const { broker, composed } = await joined({ caPem: authority.caPem, brokerAuthority: authority });
      expect(await S3Fixtures.until({ composed, holds: () => announced(broker), withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(broker.recordedServerNames).toContain(S1Fixtures.BROKER_NAME);
      expect(broker.connects).toBeGreaterThanOrEqual(1);
      const status = broker.published.find((message) => message.topic === STATUS_TOPIC);
      expect(Buffer.from(status?.payload ?? []).toString()).toBe("online");
      await broker.close();
    }, STACK_TIMEOUT);

    it("an untrusted certificate is refused and no mqtt byte arrives", async () => {
      const brokerAuthority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const otherAuthority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const { broker, composed } = await joined({ caPem: otherAuthority.caPem, brokerAuthority });
      const refused = () => composed.run.console().includes(TLS_VERIFY_FAILURE) && broker.tlsClientErrors.some((error) => error.includes(TLS_UNKNOWN_CA));
      expect(await S3Fixtures.until({ composed, holds: refused, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(broker.connects).toBe(0);
      expect(broker.published).toEqual([]);
      await broker.close();
    }, STACK_TIMEOUT);
  });

  describe("bring your own image", () => {
    it("`replica run --board panel-7 --image` boots the panel sample", async () => {
      const output = new RecordingOutput();
      const code = await Composition.cli({ root: RepositoryRoot.PATH, output }).execute(["run", "--board", "panel-7", "--image", S3Fixtures.samplePath(), "--seconds", String(CLI_SECONDS)]);
      expect(code).toBe(0);
      expect(output.written()).toContain(PROJECT_LINE);
    }, STACK_TIMEOUT);
  });
});

describe.skipIf(!existsSync(S3Fixtures.displayModelPath()))("the display model of the locked ESPHome image (needs build/samples/panel-7/display-model.py from tools/build-samples.sh)", () => {
  const model = (): string => readFileSync(S3Fixtures.displayModelPath(), "utf8");
  const listed = (colour: string): number[] => {
    const match = new RegExp(`"${colour}": \\[([0-9, ]+)\\]`).exec(model());
    return (match?.[1] ?? "").split(",").map((entry) => Number(entry.trim()));
  };
  const single = (name: string): number => Number(new RegExp(`(?<![a-z_])${name}=(\\d+)`).exec(model())?.[1]);
  const factList = (prefix: string, count: number): number[] => Array.from({ length: count }, (_, index) => FactLookup.pin({ facts: FACTS, name: `${prefix}-${index}` }));

  it("rgb pins match the model: the colour pins, the sync and enable pins and the clock pin are ESPHome's CROWPANEL-ADVANCE-7", () => {
    expect(model()).toContain('"CROWPANEL-ADVANCE-7"');
    expect(factList("display-red", listed("red").length)).toEqual(listed("red"));
    expect(factList("display-green", listed("green").length)).toEqual(listed("green"));
    expect(factList("display-blue", listed("blue").length)).toEqual(listed("blue"));
    expect(listed("red")).toHaveLength(5);
    expect(listed("green")).toHaveLength(6);
    expect(listed("blue")).toHaveLength(5);
    expect(FactLookup.pin({ facts: FACTS, name: "display-data-enable" })).toBe(single("de_pin"));
    expect(FactLookup.pin({ facts: FACTS, name: "display-horizontal-sync" })).toBe(single("hsync_pin"));
    expect(FactLookup.pin({ facts: FACTS, name: "display-vertical-sync" })).toBe(single("vsync_pin"));
    expect(FactLookup.pin({ facts: FACTS, name: "display-pixel-clock" })).toBe(single("pclk_pin"));
  });

  it("the size and porches of the facts are the model's", () => {
    expect([COLUMNS, ROWS]).toEqual([single("width"), single("height")]);
    const number = (name: string): number => FactLookup.number({ facts: FACTS, name });
    expect([number("display-horizontal-pulse-width"), number("display-horizontal-front-porch"), number("display-horizontal-back-porch")]).toEqual([single("hsync_pulse_width"), single("hsync_front_porch"), single("hsync_back_porch")]);
    expect([number("display-vertical-pulse-width"), number("display-vertical-front-porch"), number("display-vertical-back-porch")]).toEqual([single("vsync_pulse_width"), single("vsync_front_porch"), single("vsync_back_porch")]);
  });
});
