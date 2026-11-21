import { describe, expect, it } from "vitest";
import { Ina226 } from "./ina226";

const ADDRESS = 0x40;
const BUS_REGISTER = 0x02;
const SHUNT_REGISTER = 0x01;
const CALIBRATION_REGISTER = 0x05;
const CURRENT_REGISTER = 0x04;
const MANUFACTURER_REGISTER = 0xfe;

function readRegister(device: Ina226, register: number): number {
  device.start({ read: false });
  device.write(register);
  device.start({ read: true });
  const value = (device.read() << 8) | device.read();
  device.stop();
  return value;
}

function writeRegister(args: { device: Ina226; register: number; value: number }): void {
  args.device.start({ read: false });
  args.device.write(args.register);
  args.device.write(args.value >> 8);
  args.device.write(args.value & 0xff);
  args.device.stop();
}

describe("Ina226", () => {
  it("reads 13.000 V as 10400 counts of 1.25 mV", () => {
    const device = new Ina226(ADDRESS);
    device.setBusVolts(13);
    expect(readRegister(device, BUS_REGISTER)).toBe(10_400);
  });

  it("reads a shunt of 2.5 uV per count, negative as two's complement", () => {
    const device = new Ina226(ADDRESS);
    device.setShuntVolts(0.001);
    expect(readRegister(device, SHUNT_REGISTER)).toBe(400);
    device.setShuntVolts(-0.001);
    expect(readRegister(device, SHUNT_REGISTER)).toBe(0x10000 - 400);
  });

  it("derives the current from the shunt and the calibration it was given", () => {
    const device = new Ina226(ADDRESS);
    device.setShuntVolts(0.001);
    writeRegister({ device, register: CALIBRATION_REGISTER, value: 2048 });
    expect(readRegister(device, CURRENT_REGISTER)).toBe(400);
  });

  it("identifies itself and is reset by the reset bit", () => {
    const device = new Ina226(ADDRESS);
    expect(readRegister(device, MANUFACTURER_REGISTER)).toBe(0x5449);
    writeRegister({ device, register: 0x00, value: 0x1234 });
    expect(readRegister(device, 0x00)).toBe(0x1234);
    writeRegister({ device, register: 0x00, value: 0x8000 });
    expect(readRegister(device, 0x00)).toBe(0x4127);
  });
});
