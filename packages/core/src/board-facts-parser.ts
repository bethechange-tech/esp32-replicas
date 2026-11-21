import { PublicSource, type BoardFacts, type BoardId, type ChipFamily, type Fact } from "./board-facts";
import { BoundsCheck, UnitBounds, type Unit } from "./units";

const UNITS: readonly Unit[] = ["volt", "ampere", "ohm", "hertz", "baud", "pixel", "byte", "millisecond", "ratio", "gpio", "i2c-address", "none"];
const BOARD_IDS: readonly BoardId[] = ["small-screen", "small-screen-touch", "panel-7", "headless"];

export class FactsRefused extends Error {
  constructor(where: string, why: string) {
    super(`facts ${where}: ${why}`);
  }
}

type Table<T> = Readonly<Record<string, Fact<T>>>;

/** Turns the parsed facts file into typed facts, refusing a fact with no public source, an unknown unit or a number outside its unit's bounds. */
export class BoardFactsParser {
  private constructor() {}

  static parse(args: { document: unknown; board: BoardId }): BoardFacts {
    const record = BoardFactsParser.record({ value: args.document, where: "$" });
    const entry = BoardFactsParser.record({ value: record[args.board], where: args.board });
    const at = (name: string): string => `${args.board}.${name}`;
    return {
      id: args.board,
      model: BoardFactsParser.fact<string>({ value: entry["model"], where: at("model"), type: "string" }),
      chip: BoardFactsParser.chip({ value: entry["chip"], where: at("chip") }),
      flashBytes: BoardFactsParser.fact<number>({ value: entry["flashBytes"], where: at("flashBytes"), type: "number" }),
      psramBytes: BoardFactsParser.fact<number>({ value: entry["psramBytes"], where: at("psramBytes"), type: "number" }),
      pins: BoardFactsParser.table<number>({ value: entry["pins"], where: at("pins"), type: "number" }),
      numbers: BoardFactsParser.table<number>({ value: entry["numbers"], where: at("numbers"), type: "number" }),
      flags: BoardFactsParser.table<boolean>({ value: entry["flags"], where: at("flags"), type: "boolean" }),
      decisions: BoardFactsParser.decisions({ value: entry["decisions"], where: at("decisions") }),
    };
  }

  static boardIds(): readonly BoardId[] {
    return BOARD_IDS;
  }

  private static decisions(args: { value: unknown; where: string }): Readonly<Record<string, boolean>> {
    if (args.value === undefined) return {};
    const record = BoardFactsParser.record(args);
    for (const [name, decision] of Object.entries(record)) {
      if (typeof decision !== "boolean") throw new FactsRefused(`${args.where}.${name}`, "a decision is true or false");
    }
    return record as Record<string, boolean>;
  }

  private static chip(args: { value: unknown; where: string }): Fact<ChipFamily> {
    const fact = BoardFactsParser.fact<string>({ ...args, type: "string" });
    if (fact.value !== "esp32s3" && fact.value !== "esp32") throw new FactsRefused(args.where, `chip ${fact.value} is not modelled`);
    return { ...fact, value: fact.value };
  }

  private static table<T>(args: { value: unknown; where: string; type: "number" | "boolean" }): Table<T> {
    const record = BoardFactsParser.record({ value: args.value, where: args.where });
    return Object.fromEntries(Object.entries(record).map(([name, item]) => [name, BoardFactsParser.fact<T>({ value: item, where: `${args.where}.${name}`, type: args.type })]));
  }

  private static fact<T>(args: { value: unknown; where: string; type: "string" | "number" | "boolean" }): Fact<T> {
    const record = BoardFactsParser.record({ value: args.value, where: args.where });
    const { value, unit, source } = record;
    if (typeof source !== "string" || !PublicSource.isPublic(source)) throw new FactsRefused(args.where, "a fact needs a public https source");
    if (typeof unit !== "string" || !UNITS.includes(unit as Unit)) throw new FactsRefused(args.where, `unknown unit ${String(unit)}`);
    if (typeof value !== args.type) throw new FactsRefused(args.where, `the value is not a ${args.type}`);
    const refusal = typeof value === "number" ? BoardFactsParser.boundsRefusal({ unit: unit as Unit, value, where: args.where }) : undefined;
    if (refusal) throw new FactsRefused(args.where, refusal);
    return { value: value as T, unit: unit as Unit, source };
  }

  private static boundsRefusal(args: { unit: Unit; value: number; where: string }): string | undefined {
    if (args.unit === "gpio") return BoundsCheck.refusal({ name: args.where, bounds: UnitBounds.GPIO, value: args.value });
    if (args.unit === "i2c-address") return BoundsCheck.refusal({ name: args.where, bounds: UnitBounds.I2C_ADDRESS, value: args.value });
    if (args.unit === "baud") return BoundsCheck.refusal({ name: args.where, bounds: UnitBounds.BAUD, value: args.value });
    return undefined;
  }

  private static record(args: { value: unknown; where: string }): Record<string, unknown> {
    if (typeof args.value !== "object" || args.value === null || Array.isArray(args.value)) throw new FactsRefused(args.where, "an object is expected");
    return args.value as Record<string, unknown>;
  }
}
