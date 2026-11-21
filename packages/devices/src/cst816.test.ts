import { describe, expect, it } from "vitest";
import { Cst816, Cst816Limits, Cst816PositionRefused } from "./cst816";

const ADDRESS = 0x15;
const INTERRUPT_GPIO = 14;
const RESET_GPIO = 13;
const CHIP_ID_REGISTER = 0xa7;
const IRQ_CONTROL_REGISTER = 0xfa;
const IRQ_ENABLE_MOTION = 0x70;
const STATUS_REGISTER = 0x00;
const BURST_BYTES = 13;
const TOUCH_COUNT_INDEX = 2;
const CST816T_CHIP_ID = 0xb5;
const CYCLE = 0;

function controller(): Cst816 {
  return new Cst816({ address: ADDRESS, interruptGpio: INTERRUPT_GPIO, resetGpio: RESET_GPIO });
}

function readFrom(args: { device: Cst816; register: number; count: number }): number[] {
  args.device.start({ read: false });
  args.device.write(args.register);
  args.device.start({ read: true });
  const bytes = Array.from({ length: args.count }, () => args.device.read());
  args.device.stop();
  return bytes;
}

function writeTo(args: { device: Cst816; register: number; value: number }): void {
  args.device.start({ read: false });
  args.device.write(args.register);
  args.device.write(args.value);
  args.device.stop();
}

describe("Cst816", () => {
  it("answers the chip ID register with the CST816T's identifier", () => {
    expect(readFrom({ device: controller(), register: CHIP_ID_REGISTER, count: 1 })).toEqual([CST816T_CHIP_ID]);
  });

  it("reports no touch before any finger lands", () => {
    const burst = readFrom({ device: controller(), register: STATUS_REGISTER, count: BURST_BYTES });
    expect(burst).toEqual(new Array<number>(BURST_BYTES).fill(0));
  });

  it("reports one touch and its 12-bit position in the registers the driver reads, in one burst from 0x00", () => {
    const device = controller();
    device.place({ x: 0x123, y: 0xabc });
    const burst = readFrom({ device, register: STATUS_REGISTER, count: BURST_BYTES });
    expect(burst.slice(0, 7)).toEqual([0, 0, 1, 0x01, 0x23, 0x0a, 0xbc]);
    expect(burst.slice(7)).toEqual(new Array<number>(BURST_BYTES - 7).fill(0));
  });

  it("reports no touch once the finger lifts", () => {
    const device = controller();
    device.place({ x: 10, y: 20 });
    device.lift();
    expect(readFrom({ device, register: STATUS_REGISTER, count: BURST_BYTES })[TOUCH_COUNT_INDEX]).toBe(0);
    expect(device.isTouched()).toBe(false);
  });

  it("keeps what the driver writes to the IRQ control register", () => {
    const device = controller();
    writeTo({ device, register: IRQ_CONTROL_REGISTER, value: IRQ_ENABLE_MOTION });
    expect(readFrom({ device, register: IRQ_CONTROL_REGISTER, count: 1 })).toEqual([IRQ_ENABLE_MOTION]);
    expect(device.irqControl()).toBe(IRQ_ENABLE_MOTION);
  });

  it("an interrupt is a rising level, then INT low, then high again, on the interrupt pin only", () => {
    expect(controller().interrupt()).toEqual([
      { kind: "gpio", gpio: INTERRUPT_GPIO, level: true },
      { kind: "gpio", gpio: INTERRUPT_GPIO, level: false },
      { kind: "gpio", gpio: INTERRUPT_GPIO, level: true },
    ]);
  });

  describe("RST", () => {
    it("low clears a touch that was not read, and what the firmware wrote", () => {
      const device = controller();
      device.place({ x: 5, y: 6 });
      writeTo({ device, register: IRQ_CONTROL_REGISTER, value: IRQ_ENABLE_MOTION });
      device.onEdges([{ gpio: RESET_GPIO, level: false, atCycle: CYCLE }]);
      expect(device.isTouched()).toBe(false);
      expect(device.irqControl()).toBe(0);
      expect(readFrom({ device, register: STATUS_REGISTER, count: BURST_BYTES })[TOUCH_COUNT_INDEX]).toBe(0);
    });

    it("high alone, and another pin going low, clear nothing", () => {
      const device = controller();
      device.place({ x: 5, y: 6 });
      device.onEdges([
        { gpio: RESET_GPIO, level: true, atCycle: CYCLE },
        { gpio: INTERRUPT_GPIO, level: false, atCycle: CYCLE },
      ]);
      expect(device.isTouched()).toBe(true);
    });
  });

  describe("positions", () => {
    it.each([-1, 0x1000, 1.5])("refuses %s, which does not fit 12 bits", (value) => {
      expect(() => controller().place({ x: value, y: 0 })).toThrow(Cst816PositionRefused);
      expect(() => controller().place({ x: 0, y: value })).toThrow(Cst816PositionRefused);
    });

    it("the position limit is two to the number of position bits", () => {
      expect(Cst816Limits.POSITION_LIMIT).toBe(2 ** Cst816Limits.POSITION_BITS);
    });
  });
});
