import { describe, expect, it } from "vitest";
import { BacklightHelper } from "./backlight-helper";

const ADDRESS = 0x30;
const ON = 0x10;
const OTHER = 0x11;

function helper(): BacklightHelper {
  return new BacklightHelper({ address: ADDRESS, onCommand: ON });
}

function send(args: { device: BacklightHelper; byte: number }): boolean {
  args.device.start();
  const acknowledged = args.device.write(args.byte);
  args.device.stop();
  return acknowledged;
}

describe("BacklightHelper", () => {
  it("is dark until the on command arrives", () => {
    const device = helper();
    expect(device.isOn()).toBe(false);
    expect(send({ device, byte: ON })).toBe(true);
    expect(device.isOn()).toBe(true);
  });

  it("acknowledges another byte and stays dark", () => {
    const device = helper();
    expect(send({ device, byte: OTHER })).toBe(true);
    expect(device.isOn()).toBe(false);
    expect(device.bytesReceived()).toBe(1);
  });
});
