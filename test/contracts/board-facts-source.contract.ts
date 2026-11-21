import { PublicSource, type BoardFactsSource, type BoardId } from "@replicas/core";
import { describe, expect, it } from "vitest";

export interface FactsSubject {
  readonly source: BoardFactsSource;
  readonly board: BoardId;
}

/** What every `BoardFactsSource` does the same way: facts for the board asked for, each with a unit and a public source. */
export class BoardFactsSourceContract {
  private constructor() {}

  static register(args: { name: string; make: () => FactsSubject }): void {
    describe(`BoardFactsSource contract: ${args.name}`, () => {
      it("answers for the board asked for, with its chip, flash and tables", () => {
        const { source, board } = args.make();
        const facts = source.facts(board);
        expect(facts.id).toBe(board);
        expect(["esp32s3", "esp32"]).toContain(facts.chip.value);
        expect(facts.flashBytes.value).toBeGreaterThan(0);
        expect(facts.pins).toBeTypeOf("object");
        expect(facts.numbers).toBeTypeOf("object");
        expect(facts.flags).toBeTypeOf("object");
        expect(facts.decisions).toBeTypeOf("object");
      });

      it("gives every fact a unit and a public https source", () => {
        const { source, board } = args.make();
        const facts = source.facts(board);
        const all = [facts.model, facts.chip, facts.flashBytes, facts.psramBytes, ...Object.values(facts.pins), ...Object.values(facts.numbers), ...Object.values(facts.flags)];
        for (const fact of all) {
          expect(PublicSource.isPublic(fact.source)).toBe(true);
          expect(fact.unit).toBeTypeOf("string");
        }
      });
    });
  }
}
