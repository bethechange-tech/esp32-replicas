import { readFileSync } from "node:fs";
import type { BoardFactsSource, BoardId, FirmwareSource, FlashImage } from "@replicas/core";
import { FlashImageValidator } from "../../flash-image-validator";

const WHOLE_IMAGE_OFFSET = 0;

/** A `factory.bin` the user gives by path: validated against the board's facts before it is handed to an engine. */
export class UserImageSource implements FirmwareSource {
  constructor(
    private readonly parts: {
      readonly path: string;
      readonly boards: BoardFactsSource;
      readonly expectedMd5?: string;
    },
  ) {}

  async image(board: BoardId): Promise<FlashImage> {
    const facts = this.parts.boards.facts(board);
    const image: FlashImage = { bytes: new Uint8Array(readFileSync(this.parts.path)), offset: WHOLE_IMAGE_OFFSET };
    const expectedMd5 = this.parts.expectedMd5;
    FlashImageValidator.require({
      image,
      expectations: {
        chip: facts.chip.value,
        flashBytes: facts.flashBytes.value,
        ...(expectedMd5 === undefined ? {} : { expectedMd5 }),
      },
    });
    return image;
  }
}
