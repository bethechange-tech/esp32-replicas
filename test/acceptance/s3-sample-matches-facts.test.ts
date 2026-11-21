import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { FactLookup } from "@replicas/core";
import { FileBoardFacts } from "@replicas/firmware";
import { RepositoryRoot } from "../guards/support/temp-tree";
import { S1Fixtures } from "./support/s1-fixtures";

interface PinRef {
  readonly number?: string;
}
type Pin = string | PinRef;

interface SampleConfig {
  readonly i2c: { sda: Pin; scl: Pin; frequency: string };
  readonly display: readonly { platform: string; model: string; dimensions?: unknown; data_pins?: unknown }[];
  readonly touchscreen: readonly { platform: string; address: number; interrupt_pin?: Pin; reset_pin?: Pin }[];
  readonly psram: { mode: string };
  readonly esp32: { variant: string; flash_size: string };
}

const SAMPLE = readFileSync(path.join(RepositoryRoot.PATH, "sample-firmware/panel-7.yaml"), "utf8");
const FREQUENCY_PATTERN = /^(\d+)kHz$/;
const HELPER_WRITE = /id\(bus_a\)->write\((0x[0-9a-fA-F]+), &backlight_on, 1\)/;
const HELPER_COMMAND = /backlight_on = (0x[0-9a-fA-F]+);/;
const BYTES_PER_KILOBYTE = 1000;
const MODEL_NAME = "CROWPANEL-ADVANCE-7";

function gpio(pin: Pin | undefined): number {
  const text = typeof pin === "string" ? pin : (pin?.number ?? "");
  return Number(text.replace("GPIO", ""));
}

describe("the panel sample firmware says what the facts say", () => {
  const facts = new FileBoardFacts(S1Fixtures.factsPath()).facts("panel-7");
  const sample = YAML.parse(SAMPLE, { customTags: [{ tag: "!include", resolve: (value: string) => value }], logLevel: "silent" }) as SampleConfig;
  const pin = (name: string): number => FactLookup.pin({ facts, name });
  const number = (name: string): number => FactLookup.number({ facts, name });

  it("the bus pins and rate are the facts'", () => {
    expect([gpio(sample.i2c.sda), gpio(sample.i2c.scl)]).toEqual([pin("i2c-data"), pin("i2c-clock")]);
    expect(Number(FREQUENCY_PATTERN.exec(sample.i2c.frequency)?.[1]) * BYTES_PER_KILOBYTE).toBe(number("i2c-rate"));
  });

  it("the touch controller's platform and address are the facts', and it is polled: no interrupt or reset pin is wired", () => {
    const touch = sample.touchscreen[0];
    expect(touch?.platform).toBe("gt911");
    expect(touch?.address).toBe(number("touch-address"));
    expect(touch?.interrupt_pin).toBeUndefined();
    expect(touch?.reset_pin).toBeUndefined();
  });

  it("the helper is written at the fact's address with the fact's command", () => {
    expect(Number(HELPER_WRITE.exec(SAMPLE)?.[1])).toBe(number("backlight-helper-address"));
    expect(Number(HELPER_COMMAND.exec(SAMPLE)?.[1])).toBe(number("backlight-helper-on-command"));
  });

  it("the display is the model the facts cite, with no pin of its own: the pins are the model's", () => {
    const display = sample.display[0];
    expect([display?.platform, display?.model]).toEqual(["mipi_rgb", MODEL_NAME]);
    expect(display?.dimensions).toBeUndefined();
    expect(display?.data_pins).toBeUndefined();
    expect(Object.values(facts.pins).filter((fact) => fact.source.includes("mipi_rgb/models/elecrow.py")).length).toBeGreaterThan(0);
  });

  it("the chip, flash and PSRAM are the facts'", () => {
    expect(sample.esp32.variant).toBe(facts.chip.value);
    expect(sample.esp32.flash_size).toBe(`${facts.flashBytes.value / (1024 * 1024)}MB`);
    expect(sample.psram.mode).toBe("octal");
  });

  it("shares the common logger and network files with the other samples", () => {
    const small = readFileSync(path.join(RepositoryRoot.PATH, "sample-firmware/small-screen.yaml"), "utf8");
    for (const include of ["common/logger.yaml", "common/network.yaml", "common/replica-ca.h"]) {
      expect(SAMPLE).toContain(include);
      expect(small).toContain(include);
    }
  });
});
