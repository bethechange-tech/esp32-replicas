import { FlashImageRefused, FlashImageValidator } from "@replicas/firmware";
import type { FirmwareSource } from "@replicas/core";
import { describe, expect, it } from "vitest";

export interface FirmwareSubject {
  readonly valid: FirmwareSource;
  readonly invalid: FirmwareSource;
}

const BOARD = "small-screen";

/** What every `FirmwareSource` does the same way: it hands over a whole image the validator accepts, or refuses by name. */
export class FirmwareSourceContract {
  private constructor() {}

  static register(args: { name: string; make: () => FirmwareSubject; chip: "esp32s3" | "esp32"; flashBytes: number }): void {
    describe(`FirmwareSource contract: ${args.name}`, () => {
      it("hands over a whole flash image at offset 0 that the validator accepts", async () => {
        const image = await args.make().valid.image(BOARD);
        expect(image.offset).toBe(0);
        expect(FlashImageValidator.check({ image, expectations: { chip: args.chip, flashBytes: args.flashBytes } })).toBeUndefined();
      });

      it("refuses an image that fails validation, by name", async () => {
        await expect(args.make().invalid.image(BOARD)).rejects.toBeInstanceOf(FlashImageRefused);
      });
    });
  }
}
