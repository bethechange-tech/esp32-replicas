import { readFileSync } from "node:fs";
import { BoardFactsParser, type BoardFacts, type BoardFactsSource, type BoardId } from "@replicas/core";

/** The facts file (`facts/boards.json`), read once and parsed for the board asked for. */
export class FileBoardFacts implements BoardFactsSource {
  private readonly document: unknown;

  constructor(path: string) {
    this.document = JSON.parse(readFileSync(path, "utf8")) as unknown;
  }

  facts(board: BoardId): BoardFacts {
    return BoardFactsParser.parse({ document: this.document, board });
  }
}
