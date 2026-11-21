import type { BoardId } from "../board-facts";
import type { FlashImage } from "./emulator-engine";

export interface FirmwareSource {
  image(board: BoardId): Promise<FlashImage>;
}
