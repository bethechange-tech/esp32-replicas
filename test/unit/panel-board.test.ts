import { describe, expect, it } from "vitest";
import { PanelBoard } from "@replicas/boards";
import { Composition } from "@replicas/cli";
import { FactLookup, type BoardFacts } from "@replicas/core";
import { BacklightHelper, Gt911, RgbFrame } from "@replicas/devices";
import { FileBoardFacts } from "@replicas/firmware";
import { OfflineNetwork } from "@replicas/network";
import { S1Fixtures } from "../acceptance/support/s1-fixtures";

const STRANGER_ADDRESS = 0x33;
const TOUCH_STATE_HIGH = 0x81;
const TOUCH_STATE_LOW = 0x4e;
const READY_ONE_TOUCH = 0x81;
const FINGER = { x: 10, y: 20 };
const PIXEL_BYTES = 2;
const FILL = 0x5a;

function panel(): { board: PanelBoard; facts: BoardFacts } {
  const facts = new FileBoardFacts(S1Fixtures.factsPath()).facts("panel-7");
  const number = (name: string): number => FactLookup.number({ facts, name });
  const columns = number("display-visible-columns");
  const rows = number("display-visible-rows");
  const board = new PanelBoard({
    facts,
    devices: {
      display: new RgbFrame({ columns, rows }),
      backlight: new BacklightHelper({ address: number("backlight-helper-address"), onCommand: number("backlight-helper-on-command") }),
      touch: new Gt911({ address: number("touch-address"), columns, rows }),
    },
  });
  return { board, facts };
}

function sendByte(args: { board: PanelBoard; bus: number; address: number; byte: number }): boolean | number | undefined {
  const started = args.board.onI2c({ kind: "start", bus: args.bus, address: args.address, read: false });
  args.board.onI2c({ kind: "write", bus: args.bus, byte: args.byte });
  args.board.onI2c({ kind: "stop", bus: args.bus });
  return started;
}

describe("PanelBoard", () => {
  it("declares the helper's and the controller's addresses and the LCD frames, from the facts, and no SPI or UART", () => {
    const { board, facts } = panel();
    const declaration = board.declaration();
    expect(declaration.i2cAddresses.map((entry) => entry.address)).toEqual([FactLookup.number({ facts, name: "backlight-helper-address" }), FactLookup.number({ facts, name: "touch-address" })]);
    expect([declaration.routesLcdToHost, declaration.routesSpiToHost, declaration.routesUartToHost]).toEqual([true, false, false]);
    expect(declaration.psramBytes).toBe(facts.psramBytes.value);
  });

  it("answers a start at a stranger's address with a refusal, and the helper with an acknowledgement", () => {
    const { board, facts } = panel();
    const bus = FactLookup.number({ facts, name: "i2c-bus" });
    expect(board.onI2c({ kind: "start", bus, address: STRANGER_ADDRESS, read: false })).toBe(false);
    expect(board.onI2c({ kind: "start", bus, address: FactLookup.number({ facts, name: "backlight-helper-address" }), read: false })).toBe(true);
  });

  it("the panel is black until the on command reaches the helper, then shows the latest frame scanned out", () => {
    const { board, facts } = panel();
    const bus = FactLookup.number({ facts, name: "i2c-bus" });
    const address = FactLookup.number({ facts, name: "backlight-helper-address" });
    const columns = FactLookup.number({ facts, name: "display-visible-columns" });
    const rows = FactLookup.number({ facts, name: "display-visible-rows" });
    board.onLcdFrame({ width: columns, height: rows, rgb565: new Uint8Array(columns * rows * PIXEL_BYTES).fill(FILL) });
    expect(board.frame()?.rgb565.every((byte) => byte === 0)).toBe(true);
    sendByte({ board, bus, address, byte: FactLookup.number({ facts, name: "backlight-helper-on-command" }) });
    expect(board.report()["backlight-on"]).toBe(true);
    expect(board.frame()?.rgb565[0]).toBe(FILL);
  });

  it("a finger is readable at the controller's address, and lifting it clears the held touch", () => {
    const { board, facts } = panel();
    const bus = FactLookup.number({ facts, name: "i2c-bus" });
    const address = FactLookup.number({ facts, name: "touch-address" });
    board.fingerDown(FINGER);
    expect(board.report()["touch-held"]).toBe(true);
    board.onI2c({ kind: "start", bus, address, read: false });
    board.onI2c({ kind: "write", bus, byte: TOUCH_STATE_HIGH });
    board.onI2c({ kind: "write", bus, byte: TOUCH_STATE_LOW });
    board.onI2c({ kind: "start", bus, address, read: true });
    expect(board.onI2c({ kind: "read", bus })).toBe(READY_ONE_TOUCH);
    board.fingerUp();
    expect(board.report()["touch-held"]).toBe(false);
  });

  it("is composed from the facts by the composition root", () => {
    const composed = Composition.panel({
      wasm: new Uint8Array(0),
      romDirectory: "",
      factsPath: S1Fixtures.factsPath(),
      network: new OfflineNetwork(),
      log: { write: () => undefined },
      startUnixMilliseconds: S1Fixtures.START_UNIX_MILLISECONDS,
    });
    expect(composed.board.declaration().routesLcdToHost).toBe(true);
  });
});
