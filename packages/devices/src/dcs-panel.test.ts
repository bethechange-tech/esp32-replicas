import { describe, expect, it } from "vitest";
import { DcsPanel } from "./dcs-panel";

const GEOMETRY = { ramColumns: 4, ramRows: 6, visibleColumns: 4, visibleRows: 4, columnOffset: 0, rowOffset: 1, glassMirrorsColumns: false, glassMirrorsRows: false };

function send(args: { panel: DcsPanel; command: number; data?: readonly number[] }): void {
  args.panel.transfer({ host: 2, mosi: Uint8Array.from([args.command]), readLength: 0, dataCommandLevel: false });
  if (args.data) args.panel.transfer({ host: 2, mosi: Uint8Array.from(args.data), readLength: 0, dataCommandLevel: true });
}

function wake(panel: DcsPanel): void {
  send({ panel, command: 0x11 });
  send({ panel, command: 0x21 });
  send({ panel, command: 0x29 });
}

describe("DcsPanel", () => {
  it("shows nothing until sleep is out and the display is on", () => {
    const panel = new DcsPanel(GEOMETRY);
    expect(panel.frame()).toBeUndefined();
    wake(panel);
    expect(panel.frame()?.width).toBe(4);
  });

  it("takes the D/C level of each transaction: the same byte is a command at 0 and data at 1", () => {
    const panel = new DcsPanel(GEOMETRY);
    wake(panel);
    send({ panel, command: 0x2a, data: [0, 0, 0, 3] });
    send({ panel, command: 0x2b, data: [0, 1, 0, 1] });
    send({ panel, command: 0x2c, data: [0xf8, 0x00, 0x07, 0xe0] });
    expect(panel.memoryWrites()).toBe(1);
    expect(Array.from(panel.frame()?.rgb565.subarray(0, 4) ?? [])).toEqual([0xf8, 0x00, 0x07, 0xe0]);
  });

  it("shows the stored colour only while inversion is on", () => {
    const panel = new DcsPanel(GEOMETRY);
    wake(panel);
    send({ panel, command: 0x20 });
    expect(panel.frame()?.rgb565[0]).toBe(0xff);
  });

  it("mirrors the write address with MADCTL, and the read when the glass is mounted mirrored", () => {
    const panel = new DcsPanel({ ...GEOMETRY, glassMirrorsColumns: true });
    wake(panel);
    send({ panel, command: 0x36, data: [0x40] });
    send({ panel, command: 0x2a, data: [0, 0, 0, 0] });
    send({ panel, command: 0x2b, data: [0, 1, 0, 1] });
    send({ panel, command: 0x2c, data: [0xf8, 0x00] });
    expect(Array.from(panel.frame()?.rgb565.subarray(0, 2) ?? [])).toEqual([0xf8, 0x00]);
  });
});
