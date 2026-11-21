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
  readonly spi: { clk_pin: Pin; mosi_pin: Pin };
  readonly i2c: { sda: Pin; scl: Pin };
  readonly uart: { rx_pin: Pin; baud_rate: number };
  readonly output: readonly { platform: string; pin: Pin }[];
  readonly binary_sensor: readonly { pin: Pin }[];
  readonly display: readonly { cs_pin: Pin; dc_pin: Pin; reset_pin: Pin; pages: unknown; dimensions: unknown; transform: unknown }[];
  readonly sensor: readonly { platform: string; pin?: Pin; address?: number }[];
  readonly touchscreen: readonly { platform: string; address: number; interrupt_pin: Pin; reset_pin: Pin }[];
}

function gpio(pin: Pin | undefined): number {
  const text = typeof pin === "string" ? pin : (pin?.number ?? "");
  return Number(text.replace("GPIO", ""));
}

function parse(file: string): SampleConfig {
  const yaml = readFileSync(path.join(RepositoryRoot.PATH, "sample-firmware", file), "utf8");
  return YAML.parse(yaml, { customTags: [{ tag: "!include", resolve: (value: string) => value }], logLevel: "silent" }) as SampleConfig;
}

describe("the touch sample firmware says what the facts say", () => {
  const source = new FileBoardFacts(S1Fixtures.factsPath());
  const facts = source.facts("small-screen-touch");
  const sample = parse("small-screen-touch.yaml");
  const pin = (name: string): number => FactLookup.pin({ facts, name });

  it("the touch controller's platform, address and pins are the facts'", () => {
    const touch = sample.touchscreen[0];
    expect(touch?.platform).toBe("cst816");
    expect(touch?.address).toBe(FactLookup.number({ facts, name: "touch-address" }));
    expect([gpio(touch?.interrupt_pin), gpio(touch?.reset_pin)]).toEqual([pin("touch-interrupt"), pin("touch-reset")]);
  });

  it("every other pin the YAML uses is the pin of the facts", () => {
    const display = sample.display[0];
    expect([gpio(sample.spi.clk_pin), gpio(sample.spi.mosi_pin)]).toEqual([pin("display-clock"), pin("display-data")]);
    expect([gpio(display?.cs_pin), gpio(display?.dc_pin), gpio(display?.reset_pin)]).toEqual([pin("display-select"), pin("display-data-command"), pin("display-reset")]);
    expect([gpio(sample.i2c.sda), gpio(sample.i2c.scl)]).toEqual([pin("i2c-data"), pin("i2c-clock")]);
    expect(gpio(sample.uart.rx_pin)).toBe(pin("line-receive"));
    expect(sample.output.map((output) => gpio(output.pin))).toEqual([pin("power-latch"), pin("backlight")]);
    expect(sample.binary_sensor.map((sensor) => gpio(sensor.pin))).toEqual([pin("boot-button"), pin("power-button")]);
    expect(gpio(sample.sensor.find((entry) => entry.platform === "adc")?.pin)).toBe(pin("battery-sense"));
  });

  it("the monitor's address is the fact's", () => {
    expect(sample.sensor.find((entry) => entry.platform === "ina226")?.address).toBe(FactLookup.number({ facts, name: "current-monitor-address" }));
  });

  it("the touch sample is small-screen's sample apart from its name, project and touchscreen", () => {
    const apart = (config: SampleConfig): unknown => {
      const copy = structuredClone(config) as unknown as Record<string, unknown> & { esphome: Record<string, unknown> };
      delete copy["touchscreen"];
      delete copy["substitutions"];
      delete copy.esphome["project"];
      return copy;
    };
    expect(apart(sample)).toEqual(apart(parse("small-screen.yaml")));
  });
});

describe("small-screen-touch is small-screen plus a touch controller, in the facts", () => {
  const source = new FileBoardFacts(S1Fixtures.factsPath());
  const plain = source.facts("small-screen");
  const touch = source.facts("small-screen-touch");
  const TOUCH_ONLY = ["touch-interrupt", "touch-reset", "touch-address"];

  const sameValues = (args: { left: Readonly<Record<string, { value: unknown; unit: string }>>; right: Readonly<Record<string, { value: unknown; unit: string }>> }): boolean[] =>
    Object.keys(args.left).map((name) => args.left[name]?.value === args.right[name]?.value && args.left[name]?.unit === args.right[name]?.unit);

  it("every pin, number and decision of small-screen is the same in small-screen-touch", () => {
    expect(sameValues({ left: plain.pins, right: touch.pins }).every(Boolean)).toBe(true);
    expect(sameValues({ left: plain.numbers, right: touch.numbers }).every(Boolean)).toBe(true);
    expect(touch.decisions).toEqual(plain.decisions);
    expect([touch.chip.value, touch.flashBytes.value, touch.psramBytes.value]).toEqual([plain.chip.value, plain.flashBytes.value, plain.psramBytes.value]);
  });

  it("small-screen-touch adds exactly the touch controller's three facts", () => {
    const added = [...Object.keys(touch.pins), ...Object.keys(touch.numbers)].filter((name) => !(name in plain.pins) && !(name in plain.numbers));
    expect(added.sort()).toEqual([...TOUCH_ONLY].sort());
  });

  it("the touch controller's address is 0x15 and its interrupt and reset pins differ from every other pin", () => {
    expect(FactLookup.number({ facts: touch, name: "touch-address" })).toBe(0x15);
    const pins = Object.values(touch.pins).map((fact) => fact.value);
    expect(new Set(pins).size).toBe(pins.length);
  });
});
