import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Composition } from "@replicas/cli";
import { FactLookup } from "@replicas/core";
import { FileBoardFacts } from "@replicas/firmware";
import { InProcessMqttBroker, NodeSocketNetwork } from "@replicas/network";
import { ImprovSerial } from "@replicas/setup";
import { TestCa } from "@replicas/firmware";
import { FixedClock } from "../fakes/fixed-clock";
import { RecordingOutput } from "../fakes/recording-output";
import { RepositoryRoot } from "../guards/support/temp-tree";
import { DhcpFrames } from "./support/dhcp-frames";
import { PngEncoder } from "./support/png-encoder";
import { S1Fixtures } from "./support/s1-fixtures";

const PROJECT_LINE = "Project replica.small-screen version 1.0.0";
const CLI_SECONDS = 3;
const BOOT_SECONDS = 3_000;
const SETTLE_MILLISECONDS = 500;
const BUTTON_PRESS_MILLISECONDS = 300;
const HOLD_MARGIN_MILLISECONDS = 100;
const SHORT_PRESS_MILLISECONDS = 300;
const NO_RESET_WINDOW_MILLISECONDS = 20_000;
const NETWORK_WINDOW_MILLISECONDS = 60_000;
const DHCP_ADDRESS = "10.0.2.15";
const MIN_COLOURS = 8;
const FRAME_WIDTH = 240;
const FRAME_HEIGHT = 280;
const ROM_BANNER = "ESP-ROM:esp32s3";
const ORANGE_MARKER_PIXELS = 24;
const TLS_VERIFY_FAILURE = "mbedtls_ssl_handshake returned -0x2700";
const TLS_UNKNOWN_CA = "unknown ca";
const STATUS_TOPIC = "replica/replica-small-screen/status";
const FACTS = new FileBoardFacts(S1Fixtures.factsPath()).facts("small-screen");
const BOOT_GPIO = FactLookup.pin({ facts: FACTS, name: "boot-button" });
const POWER_GPIO = FactLookup.pin({ facts: FACTS, name: "power-button" });
/** The sample firmware's own setting (`min_length` of the PWR click in small-screen.yaml), asserted equal in s1-sample-matches-facts. */
const POWER_HOLD_FACT_MILLISECONDS = 3_500;
const PACK_VOLTS = 3.75;
const PACK_TOLERANCE = 0.05;
const MONITOR_VOLTS = 13;
const STACK_TIMEOUT = 300_000;
const ORANGE_RGB565 = (0xff >> 3) << 11 | (0x80 >> 2) << 5;

function distinctColours(rgb565: Uint8Array): number {
  const seen = new Set<number>();
  for (let at = 0; at < rgb565.length; at += 2) seen.add(((rgb565[at] ?? 0) << 8) | (rgb565[at + 1] ?? 0));
  return seen.size;
}

function announced(broker: InProcessMqttBroker): boolean {
  return broker.published.some((message) => message.topic === STATUS_TOPIC);
}

function pixel(args: { rgb565: Uint8Array; x: number; y: number }): number {
  const at = (args.y * FRAME_WIDTH + args.x) * 2;
  return ((args.rgb565[at] ?? 0) << 8) | (args.rgb565[at + 1] ?? 0);
}

describe.skipIf(!S1Fixtures.ready())("small-screen (needs build/esp32sim.wasm, build/roms and build/samples from tools/build-samples.sh)", () => {
  describe("the sample matches its lock (AC1.1)", () => {
    it("the factory.bin and firmware.elf SHA-256 equal samples.lock", () => {
      const lock = S1Fixtures.lock();
      const sample = lock.samples["small-screen"];
      expect(sample?.factorySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(S1Fixtures.sha256(S1Fixtures.samplePath())).toBe(sample?.factorySha256);
      expect(S1Fixtures.sha256(S1Fixtures.samplePath().replace("factory.bin", "firmware.elf"))).toBe(sample?.elfSha256);
      expect(lock.esphome.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    });
  });

  describe("boots (AC1.2)", () => {
    it("names the sample and version and does not reset in 20 emulated seconds", async () => {
      const { run } = await S1Fixtures.booted(NO_RESET_WINDOW_MILLISECONDS);
      expect(run.console()).toContain(PROJECT_LINE);
      expect(run.console().split(ROM_BANNER)).toHaveLength(2);
      expect(run.emulatedMilliseconds()).toBeGreaterThanOrEqual(NO_RESET_WINDOW_MILLISECONDS);
    }, STACK_TIMEOUT);
  });

  describe("the screen matches its golden (AC1.3)", () => {
    it("is 240x280, shows at least 8 colours, is upright, and is bit-identical to the reviewed golden in three runs", async () => {
      const pngs: Uint8Array[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const booted = await S1Fixtures.booted(BOOT_SECONDS);
        const frame = booted.frame();
        expect([frame.width, frame.height]).toEqual([FRAME_WIDTH, FRAME_HEIGHT]);
        expect(distinctColours(frame.rgb565)).toBeGreaterThanOrEqual(MIN_COLOURS);
        const orange = pixel({ rgb565: frame.rgb565, x: 0, y: 0 });
        expect(orange).toBe(ORANGE_RGB565);
        expect(pixel({ rgb565: frame.rgb565, x: FRAME_WIDTH - 1, y: FRAME_HEIGHT - 1 })).not.toBe(orange);
        expect(frame.rgb565.length / 2).toBeGreaterThan(ORANGE_MARKER_PIXELS);
        pngs.push(PngEncoder.encode(frame));
        S1Fixtures.preview({ name: "colour-bars", png: PngEncoder.encode(frame) });
      }
      expect(Buffer.from(pngs[1] ?? []).equals(Buffer.from(pngs[0] ?? []))).toBe(true);
      expect(Buffer.from(pngs[2] ?? []).equals(Buffer.from(pngs[0] ?? []))).toBe(true);
      expect(Buffer.from(pngs[0] ?? []).equals(Buffer.from(S1Fixtures.golden("colour-bars")))).toBe(true);
    }, STACK_TIMEOUT);
  });

  describe("buttons and the power latch (AC1.4)", () => {
    it("BOOT shows the next page, which matches its golden", async () => {
      const booted = await S1Fixtures.booted(BOOT_SECONDS);
      const first = PngEncoder.encode(booted.frame());
      booted.run.send({ kind: "gpio", gpio: BOOT_GPIO, level: false });
      await booted.run.runFor(BUTTON_PRESS_MILLISECONDS);
      booted.run.send({ kind: "gpio", gpio: BOOT_GPIO, level: true });
      await booted.run.runFor(SETTLE_MILLISECONDS * 3);
      const second = PngEncoder.encode(booted.frame());
      S1Fixtures.preview({ name: "ruler", png: second });
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(false);
      expect(Buffer.from(second).equals(Buffer.from(S1Fixtures.golden("ruler")))).toBe(true);
    }, STACK_TIMEOUT);

    it("SYS_EN is high after boot, and a PWR hold of the declared length drives it low in the board's report", async () => {
      const booted = await S1Fixtures.booted(BOOT_SECONDS);
      expect(booted.board.report()["power-held"]).toBe(true);
      booted.run.send({ kind: "gpio", gpio: POWER_GPIO, level: false });
      await booted.run.runFor(POWER_HOLD_FACT_MILLISECONDS + HOLD_MARGIN_MILLISECONDS);
      expect(booted.board.report()["power-held"]).toBe(true);
      booted.run.send({ kind: "gpio", gpio: POWER_GPIO, level: true });
      await booted.run.runFor(SETTLE_MILLISECONDS * 2);
      expect(booted.board.report()["power-held"]).toBe(false);
    }, STACK_TIMEOUT);

    it.each([
      { name: "a short press", milliseconds: SHORT_PRESS_MILLISECONDS },
      { name: "a hold just under the declared length", milliseconds: POWER_HOLD_FACT_MILLISECONDS - HOLD_MARGIN_MILLISECONDS },
    ])("$name keeps power on", async ({ milliseconds }) => {
      const booted = await S1Fixtures.booted(BOOT_SECONDS);
      booted.run.send({ kind: "gpio", gpio: POWER_GPIO, level: false });
      await booted.run.runFor(milliseconds);
      booted.run.send({ kind: "gpio", gpio: POWER_GPIO, level: true });
      await booted.run.runFor(SETTLE_MILLISECONDS * 4);
      expect(booted.board.report()["power-held"]).toBe(true);
    }, STACK_TIMEOUT);
  });

  describe("wifi and the broker", () => {
    async function joined(args: { caPem: string | undefined; brokerAuthority: TestCa }) {
      const broker = await InProcessMqttBroker.serving(args.brokerAuthority);
      const address = await broker.listen();
      const composed = S1Fixtures.compose(new NodeSocketNetwork({ [S1Fixtures.BROKER_NAME]: address }));
      await S1Fixtures.start({ composed, ...(args.caPem === undefined ? {} : { caPem: args.caPem }) });
      await composed.run.runFor(BOOT_SECONDS);
      composed.run.send({ kind: "console", bytes: new ImprovSerial().sendWifiSettings(S1Fixtures.WIFI) });
      return { broker, composed };
    }

    it("improv sets wifi, the DHCP ACK for 10.0.2.15 is on the wire, and after a restart the saved network is reused (AC1.5)", async () => {
      const authority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const { broker, composed } = await joined({ caPem: authority.caPem, brokerAuthority: authority });
      const acknowledged = () => DhcpFrames.acknowledgedAddresses(composed.run.networkFrames());
      expect(await S1Fixtures.until({ composed, holds: () => acknowledged().length >= 1, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(acknowledged()[0]).toBe(DHCP_ADDRESS);
      expect(await S1Fixtures.until({ composed, holds: () => announced(broker), withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      composed.run.send(composed.board.lineInput("restart"));
      expect(await S1Fixtures.until({ composed, holds: () => composed.run.console().split(ROM_BANNER).length >= 3, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(await S1Fixtures.until({ composed, holds: () => acknowledged().length >= 2, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(acknowledged()[1]).toBe(DHCP_ADDRESS);
      await broker.close();
    }, STACK_TIMEOUT);

    it("mqtt over tls: the SNI is broker.replica.test, CONNECT and one publish reach the broker (AC1.6)", async () => {
      const authority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const { broker, composed } = await joined({ caPem: authority.caPem, brokerAuthority: authority });
      expect(await S1Fixtures.until({ composed, holds: () => announced(broker), withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(broker.recordedServerNames).toContain(S1Fixtures.BROKER_NAME);
      expect(broker.connects).toBeGreaterThanOrEqual(1);
      const status = broker.published.find((message) => message.topic === STATUS_TOPIC);
      expect(Buffer.from(status?.payload ?? []).toString()).toBe("online");
      await broker.close();
    }, STACK_TIMEOUT);

    it("an untrusted certificate is refused: the device reports the verification failure, the broker sees the abandoned handshake, and no mqtt byte arrives (AC1.6)", async () => {
      const brokerAuthority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const otherAuthority = new TestCa(new FixedClock(S1Fixtures.START_UNIX_MILLISECONDS));
      const { broker, composed } = await joined({ caPem: otherAuthority.caPem, brokerAuthority });
      const refused = () => composed.run.console().includes(TLS_VERIFY_FAILURE) && broker.tlsClientErrors.some((error) => error.includes(TLS_UNKNOWN_CA));
      expect(await S1Fixtures.until({ composed, holds: refused, withinMilliseconds: NETWORK_WINDOW_MILLISECONDS })).toBe(true);
      expect(composed.run.console()).toContain(TLS_VERIFY_FAILURE);
      expect(broker.tlsClientErrors.some((error) => error.includes(TLS_UNKNOWN_CA))).toBe(true);
      expect(broker.recordedServerNames).toContain(S1Fixtures.BROKER_NAME);
      expect(broker.connects).toBe(0);
      expect(broker.published).toEqual([]);
      await broker.close();
    }, STACK_TIMEOUT);
  });

  describe("attachments read their declared units (AC1.7, and the carry-over of AC0b.4)", () => {
    it("I2C, SPI with its D/C level and UART RX all reach the real sample", async () => {
      const booted = await S1Fixtures.booted(BOOT_SECONDS);
      booted.board.monitorVolts(MONITOR_VOLTS);
      booted.run.send(booted.board.packVolts(PACK_VOLTS));
      booted.run.send(booted.board.lineInput("hello replica"));
      await booted.run.runFor(BOOT_SECONDS);
      const text = booted.run.console();
      expect(text).toContain("INA226 bus voltage 13.000 V");
      const adc = [...text.matchAll(/ADC GPIO1 pack voltage ([0-9.]+) V/g)].map((match) => Number(match[1])).at(-1) ?? Number.NaN;
      expect(Math.abs(adc - PACK_VOLTS)).toBeLessThanOrEqual(PACK_TOLERANCE);
      expect(text).toContain("received: hello replica");
      expect(booted.board.report()["display-writes"]).toBeGreaterThan(0);
    }, STACK_TIMEOUT);
  });

  describe("bring your own image (AC1.8)", () => {
    const run = (args: { image: string; output: RecordingOutput }) =>
      Composition.cli({ root: RepositoryRoot.PATH, output: args.output }).execute(["run", "--board", "small-screen", "--image", args.image, "--seconds", String(CLI_SECONDS)]);

    it("`replica run --image` boots the sample through UserImageSource", async () => {
      const output = new RecordingOutput();
      expect(await run({ image: S1Fixtures.samplePath(), output })).toBe(0);
      expect(output.written()).toContain(PROJECT_LINE);
    }, STACK_TIMEOUT);

    it("a corrupted copy is refused by name before boot: exit 2, and the ROM never starts", async () => {
      const damaged = path.join(mkdtempSync(path.join(tmpdir(), "replica-image-")), "damaged.bin");
      const bytes = readFileSync(S1Fixtures.samplePath());
      bytes[0] = 0x00;
      writeFileSync(damaged, bytes);
      const output = new RecordingOutput();
      expect(await run({ image: damaged, output })).toBe(2);
      expect(output.written()).toBe("image refused: bad-magic\n");
    }, STACK_TIMEOUT);
  });
});

describe("a board with no replica yet is refused by name", () => {
  it("panel-7 gives one line and exit 2, not a stack", async () => {
    const output = new RecordingOutput();
    const code = await Composition.cli({ root: RepositoryRoot.PATH, output }).execute(["run", "--board", "panel-7", "--image", "missing.bin"]);
    expect(code).toBe(2);
    expect(output.written().trim().split("\n")).toHaveLength(1);
    expect(output.written()).toContain("panel-7");
  });
});
