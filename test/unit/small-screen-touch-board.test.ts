import { describe, expect, it } from "vitest";
import { SmallScreenBoard, NoTouchController } from "@replicas/boards";
import { FactLookup, type BoardFacts } from "@replicas/core";
import { Cst816, DcsPanel, Ina226, LineSource, PowerLatch } from "@replicas/devices";
import { FileBoardFacts } from "@replicas/firmware";
import { S1Fixtures } from "../acceptance/support/s1-fixtures";

const READ_REGISTER = 0xa7;
const CST816T_CHIP_ID = 0xb5;
const STRANGER_ADDRESS = 0x33;

function devices(facts: BoardFacts) {
  const number = (name: string): number => FactLookup.number({ facts, name });
  return {
    panel: new DcsPanel({
      ramColumns: number("display-ram-columns"),
      ramRows: number("display-ram-rows"),
      visibleColumns: number("display-visible-columns"),
      visibleRows: number("display-visible-rows"),
      columnOffset: number("display-column-offset"),
      rowOffset: number("display-row-offset"),
      glassMirrorsColumns: FactLookup.decision({ facts, name: "display-mirror-x" }),
      glassMirrorsRows: FactLookup.decision({ facts, name: "display-mirror-y" }),
    }),
    currentMonitor: new Ina226(number("current-monitor-address")),
    powerLatch: new PowerLatch(FactLookup.pin({ facts, name: "power-latch" })),
    line: new LineSource({ pin: FactLookup.pin({ facts, name: "line-receive" }), baud: number("line-baud") }),
  };
}

function touchBoard(): { board: SmallScreenBoard; facts: BoardFacts } {
  const facts = new FileBoardFacts(S1Fixtures.factsPath()).facts("small-screen-touch");
  const touch = new Cst816({
    address: FactLookup.number({ facts, name: "touch-address" }),
    interruptGpio: FactLookup.pin({ facts, name: "touch-interrupt" }),
    resetGpio: FactLookup.pin({ facts, name: "touch-reset" }),
  });
  return { board: SmallScreenBoard.withTouch({ facts, devices: devices(facts), touch }), facts };
}

describe("SmallScreenBoard", () => {
  it("withoutTouch declares the monitor's address only, and refuses a finger by name", () => {
    const facts = new FileBoardFacts(S1Fixtures.factsPath()).facts("small-screen");
    const board = SmallScreenBoard.withoutTouch({ facts, devices: devices(facts) });
    expect(board.declaration().i2cAddresses.map((entry) => entry.address)).toEqual([FactLookup.number({ facts, name: "current-monitor-address" })]);
    expect(() => board.fingerDown({ x: 1, y: 1 })).toThrow(NoTouchController);
    expect(Object.keys(board.report())).not.toContain("touch-held");
  });

  it("withTouch declares the monitor's and the controller's addresses, from the facts", () => {
    const { board, facts } = touchBoard();
    expect(board.declaration().i2cAddresses.map((entry) => entry.address)).toEqual([FactLookup.number({ facts, name: "current-monitor-address" }), FactLookup.number({ facts, name: "touch-address" })]);
  });

  it("routes an I2C transaction at the controller's address to the controller, and answers none at another", () => {
    const { board, facts } = touchBoard();
    const bus = FactLookup.number({ facts, name: "i2c-bus" });
    const address = FactLookup.number({ facts, name: "touch-address" });
    expect(board.onI2c({ kind: "start", bus, address, read: false })).toBe(true);
    board.onI2c({ kind: "write", bus, byte: READ_REGISTER });
    expect(board.onI2c({ kind: "start", bus, address, read: true })).toBe(true);
    expect(board.onI2c({ kind: "read", bus })).toBe(CST816T_CHIP_ID);
    board.onI2c({ kind: "stop", bus });
    expect(board.onI2c({ kind: "start", bus, address: STRANGER_ADDRESS, read: false })).toBe(false);
  });

  it("a finger down holds the touch and hands back INT's pulse; a reset edge from the firmware clears it", () => {
    const { board, facts } = touchBoard();
    const interrupt = FactLookup.pin({ facts, name: "touch-interrupt" });
    const reset = FactLookup.pin({ facts, name: "touch-reset" });
    expect(board.fingerDown({ x: 5, y: 6 }).every((input) => input.kind === "gpio" && input.gpio === interrupt)).toBe(true);
    expect(board.report()["touch-held"]).toBe(true);
    board.onGpio([{ gpio: reset, level: false, atCycle: 0 }]);
    expect(board.report()["touch-held"]).toBe(false);
  });
});
