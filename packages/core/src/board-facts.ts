import type { Unit } from "./units";

export type BoardId = "small-screen" | "small-screen-touch" | "panel-7" | "headless";

export type ChipFamily = "esp32s3" | "esp32";

/** A number or name with the unit it is in and the public page that states it. */
export interface Fact<T> {
  readonly value: T;
  readonly unit: Unit;
  readonly source: string;
}

export interface BoardFacts {
  readonly id: BoardId;
  readonly model: Fact<string>;
  readonly chip: Fact<ChipFamily>;
  readonly flashBytes: Fact<number>;
  readonly psramBytes: Fact<number>;
  /** Named GPIO numbers: `display-clock`, `power-latch`, and so on. */
  readonly pins: Readonly<Record<string, Fact<number>>>;
  /** Named sizes, addresses, ratios and rates, each in the unit it declares. */
  readonly numbers: Readonly<Record<string, Fact<number>>>;
  readonly flags: Readonly<Record<string, Fact<boolean>>>;
  /** Choices of the model, not facts about the hardware: no source, and each is explained in docs/boards.md. */
  readonly decisions: Readonly<Record<string, boolean>>;
}

export class UnknownFact extends Error {
  constructor(args: { board: BoardId; name: string }) {
    super(`the facts of ${args.board} hold no ${args.name}`);
  }
}

export class PublicSource {
  private constructor() {}

  static isPublic(source: string): boolean {
    return source.startsWith("https://") && !source.includes(" ");
  }
}

export class FactLookup {
  private constructor() {}

  static pin(args: { facts: BoardFacts; name: string }): number {
    return FactLookup.found({ facts: args.facts, name: args.name, table: args.facts.pins }).value;
  }

  static number(args: { facts: BoardFacts; name: string }): number {
    return FactLookup.found({ facts: args.facts, name: args.name, table: args.facts.numbers }).value;
  }

  static flag(args: { facts: BoardFacts; name: string }): boolean {
    return FactLookup.found({ facts: args.facts, name: args.name, table: args.facts.flags }).value;
  }

  static decision(args: { facts: BoardFacts; name: string }): boolean {
    const decision = args.facts.decisions[args.name];
    if (decision === undefined) throw new UnknownFact({ board: args.facts.id, name: args.name });
    return decision;
  }

  private static found<T>(args: { facts: BoardFacts; name: string; table: Readonly<Record<string, Fact<T>>> }): Fact<T> {
    const fact = args.table[args.name];
    if (!fact) throw new UnknownFact({ board: args.facts.id, name: args.name });
    return fact;
  }
}
