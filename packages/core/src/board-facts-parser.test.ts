import { describe, expect, it } from "vitest";
import { BoardFactsParser, FactsRefused } from "./board-facts-parser";

const SOURCE = "https://example.org/page";
const fact = (value: unknown, unit: string) => ({ value, unit, source: SOURCE });
const board = (overrides: Record<string, unknown> = {}) => ({
  "small-screen": {
    model: fact("a board", "none"),
    chip: fact("esp32s3", "none"),
    flashBytes: fact(16, "byte"),
    psramBytes: fact(8, "byte"),
    pins: { led: fact(2, "gpio") },
    numbers: {},
    flags: {},
    ...overrides,
  },
});

describe("BoardFactsParser", () => {
  it("parses facts and keeps each unit and source", () => {
    const facts = BoardFactsParser.parse({ document: board(), board: "small-screen" });
    expect(facts.pins["led"]).toEqual({ value: 2, unit: "gpio", source: SOURCE });
  });

  it("refuses a fact with no public source, an unknown unit, or a pin beyond the chip", () => {
    const parse = (overrides: Record<string, unknown>) => () => BoardFactsParser.parse({ document: board(overrides), board: "small-screen" });
    expect(parse({ pins: { led: { ...fact(2, "gpio"), source: "http://example.org" } } })).toThrow(FactsRefused);
    expect(parse({ pins: { led: fact(2, "parsec") } })).toThrow(/unknown unit/);
    expect(parse({ pins: { led: fact(60, "gpio") } })).toThrow(/outside 0 to 48/);
  });
});
