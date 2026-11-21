import type { ChipFamily } from "../board-facts";

/** The mask ROM image a chip boots from. Never part of this repository: it is downloaded and checked. */
export interface RomSource {
  rom(chip: ChipFamily): Uint8Array;
}
