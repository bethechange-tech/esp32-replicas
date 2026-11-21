import type { BoardFacts, BoardFactsSource, BoardId, ChipFamily } from "@replicas/core";

const SOURCE = "https://example.org/test-facts";

/** Facts for tests: every board has the chip and flash it was built with, and no source worth citing. */
export class FixedBoardFacts implements BoardFactsSource {
  constructor(private readonly args: { chip: ChipFamily; flashBytes: number }) {}

  facts(board: BoardId): BoardFacts {
    return {
      id: board,
      model: { value: "test board", unit: "none", source: SOURCE },
      chip: { value: this.args.chip, unit: "none", source: SOURCE },
      flashBytes: { value: this.args.flashBytes, unit: "byte", source: SOURCE },
      psramBytes: { value: 0, unit: "byte", source: SOURCE },
    };
  }
}
