import { describe, expect, it } from "vitest";
import { Gt911, Gt911PositionRefused } from "./gt911";

const ADDRESS = 0x5d;
const COLUMNS = 800;
const ROWS = 480;
const SWITCHES = 0x804d;
const MAX_VALUES = 0x8048;
const TOUCH_STATE = 0x814e;
const TOUCHES = 0x814f;
const READY_ONE_TOUCH = 0x81;
const READY_NO_TOUCH = 0x80;
const POINT = { x: 700, y: 300 };
const TOUCH_BYTES = 8;
const MAX_BYTES = 4;
const HIGH_SHIFT = 8;
const BYTE_MASK = 0xff;

function controller(): Gt911 {
  return new Gt911({ address: ADDRESS, columns: COLUMNS, rows: ROWS });
}

function readFrom(args: { device: Gt911; register: number; count: number }): number[] {
  args.device.start({ read: false });
  args.device.write(args.register >> HIGH_SHIFT);
  args.device.write(args.register & BYTE_MASK);
  args.device.start({ read: true });
  const bytes = Array.from({ length: args.count }, () => args.device.read());
  args.device.stop();
  return bytes;
}

function word(args: { bytes: readonly number[]; at: number }): number {
  return (args.bytes[args.at] ?? 0) | ((args.bytes[args.at + 1] ?? 0) << HIGH_SHIFT);
}

function clearState(device: Gt911): void {
  device.start({ read: false });
  device.write(TOUCH_STATE >> HIGH_SHIFT);
  device.write(TOUCH_STATE & BYTE_MASK);
  device.write(0);
  device.stop();
}

describe("Gt911", () => {
  it("reports the panel size as its maximum position, low byte first, as the driver calibrates from it", () => {
    const bytes = readFrom({ device: controller(), register: MAX_VALUES, count: MAX_BYTES });
    expect([word({ bytes, at: 0 }), word({ bytes, at: 2 })]).toEqual([COLUMNS, ROWS]);
  });

  it("answers the switches register with an active-low interrupt", () => {
    expect(readFrom({ device: controller(), register: SWITCHES, count: 1 })).toEqual([1]);
  });

  it("reads no data with no finger down", () => {
    expect(readFrom({ device: controller(), register: TOUCH_STATE, count: 1 })).toEqual([0]);
  });

  it("a finger is one ready touch with its position in the driver's byte order", () => {
    const device = controller();
    device.place(POINT);
    expect(readFrom({ device, register: TOUCH_STATE, count: 1 })).toEqual([READY_ONE_TOUCH]);
    const touch = readFrom({ device, register: TOUCHES, count: TOUCH_BYTES });
    expect([word({ bytes: touch, at: 1 }), word({ bytes: touch, at: 3 })]).toEqual([POINT.x, POINT.y]);
  });

  it("while the finger rests, clearing the state does not end the touch", () => {
    const device = controller();
    device.place(POINT);
    clearState(device);
    expect(readFrom({ device, register: TOUCH_STATE, count: 1 })).toEqual([READY_ONE_TOUCH]);
  });

  it("after the finger lifts the status reads ready with no touch until it is cleared, then nothing", () => {
    const device = controller();
    device.place(POINT);
    device.lift();
    expect(readFrom({ device, register: TOUCH_STATE, count: 1 })).toEqual([READY_NO_TOUCH]);
    clearState(device);
    expect(readFrom({ device, register: TOUCH_STATE, count: 1 })).toEqual([0]);
  });

  it("refuses a position off the panel by name", () => {
    expect(() => controller().place({ x: COLUMNS, y: 0 })).toThrow(Gt911PositionRefused);
    expect(() => controller().place({ x: 0, y: -1 })).toThrow(Gt911PositionRefused);
  });
});
