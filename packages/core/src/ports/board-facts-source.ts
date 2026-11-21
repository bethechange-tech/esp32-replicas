import type { BoardFacts, BoardId } from "../board-facts";

export interface BoardFactsSource {
  facts(board: BoardId): BoardFacts;
}
