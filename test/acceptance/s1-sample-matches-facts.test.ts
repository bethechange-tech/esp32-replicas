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
  readonly display: readonly { cs_pin: Pin; dc_pin: Pin; reset_pin: Pin; dimensions: { width: number; height: number; offset_height: number }; transform: { mirror_x: boolean; mirror_y: boolean } }[];
  readonly sensor: readonly { platform: string; pin?: Pin; address?: number; filters?: readonly { multiply: number }[] }[];
}

function gpio(pin: Pin | undefined): number {
  const text = typeof pin === "string" ? pin : (pin?.number ?? "");
  return Number(text.replace("GPIO", ""));
}

describe("the sample firmware says what the facts say", () => {
  const facts = new FileBoardFacts(S1Fixtures.factsPath()).facts("small-screen");
  const yaml = readFileSync(path.join(RepositoryRoot.PATH, "sample-firmware/small-screen.yaml"), "utf8");
  const sample = YAML.parse(yaml, { customTags: [{ tag: "!include", resolve: (value: string) => value }], logLevel: "silent" }) as SampleConfig;
  const pin = (name: string): number => FactLookup.pin({ facts, name });
  const number = (name: string): number => FactLookup.number({ facts, name });

  it("every pin the YAML uses is the pin of the facts", () => {
    const display = sample.display[0];
    expect([gpio(sample.spi.clk_pin), gpio(sample.spi.mosi_pin)]).toEqual([pin("display-clock"), pin("display-data")]);
    expect([gpio(display?.cs_pin), gpio(display?.dc_pin), gpio(display?.reset_pin)]).toEqual([pin("display-select"), pin("display-data-command"), pin("display-reset")]);
    expect([gpio(sample.i2c.sda), gpio(sample.i2c.scl)]).toEqual([pin("i2c-data"), pin("i2c-clock")]);
    expect(gpio(sample.uart.rx_pin)).toBe(pin("line-receive"));
    expect(sample.output.map((output) => gpio(output.pin))).toEqual([pin("power-latch"), pin("backlight")]);
    expect(sample.binary_sensor.map((sensor) => gpio(sensor.pin))).toEqual([pin("boot-button"), pin("power-button")]);
    expect(gpio(sample.sensor.find((sensor) => sensor.platform === "adc")?.pin)).toBe(pin("battery-sense"));
  });

  it("the addresses, sizes, rates and divider of the YAML are the numbers of the facts", () => {
    const display = sample.display[0];
    expect(sample.sensor.find((sensor) => sensor.platform === "ina226")?.address).toBe(number("current-monitor-address"));
    expect(sample.uart.baud_rate).toBe(number("line-baud"));
    expect(sample.sensor.find((sensor) => sensor.platform === "adc")?.filters?.[0]?.multiply).toBe(number("battery-divider-ratio"));
    expect([display?.dimensions.width, display?.dimensions.height, display?.dimensions.offset_height]).toEqual([number("display-visible-columns"), number("display-visible-rows"), number("display-row-offset")]);
    expect([display?.transform.mirror_x, display?.transform.mirror_y]).toEqual([FactLookup.decision({ facts, name: "display-mirror-x" }), FactLookup.decision({ facts, name: "display-mirror-y" })]);
  });
});
