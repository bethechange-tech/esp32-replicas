import { describe, expect, it } from "vitest";
import { RgbFrame } from "./rgb-frame";

const COLUMNS = 4;
const ROWS = 2;
const BYTES = COLUMNS * ROWS * 2;
const FILL = 0xab;

function frameOf(args: { width: number; height: number; bytes: number }) {
  return { width: args.width, height: args.height, rgb565: new Uint8Array(args.bytes).fill(FILL) };
}

describe("RgbFrame", () => {
  it("shows nothing until a frame is scanned out, then the latest one", () => {
    const panel = new RgbFrame({ columns: COLUMNS, rows: ROWS });
    expect(panel.latest()).toBeUndefined();
    panel.receive(frameOf({ width: COLUMNS, height: ROWS, bytes: BYTES }));
    expect(panel.latest()?.rgb565[0]).toBe(FILL);
    expect(panel.framesAccepted()).toBe(1);
  });

  it("keeps its own copy of the frame, so the engine's memory view may change", () => {
    const panel = new RgbFrame({ columns: COLUMNS, rows: ROWS });
    const source = frameOf({ width: COLUMNS, height: ROWS, bytes: BYTES });
    panel.receive(source);
    source.rgb565.fill(0);
    expect(panel.latest()?.rgb565[0]).toBe(FILL);
  });

  it("drops a frame of another size and counts it", () => {
    const panel = new RgbFrame({ columns: COLUMNS, rows: ROWS });
    panel.receive(frameOf({ width: ROWS, height: COLUMNS, bytes: BYTES }));
    panel.receive(frameOf({ width: COLUMNS, height: ROWS, bytes: BYTES - 1 }));
    expect(panel.latest()).toBeUndefined();
    expect([panel.framesAccepted(), panel.framesRefused()]).toEqual([0, 2]);
  });

  it("dark is every pixel black at the panel's size", () => {
    const dark = new RgbFrame({ columns: COLUMNS, rows: ROWS }).dark();
    expect([dark.width, dark.height, dark.rgb565.length]).toEqual([COLUMNS, ROWS, BYTES]);
    expect(dark.rgb565.every((byte) => byte === 0)).toBe(true);
  });
});
