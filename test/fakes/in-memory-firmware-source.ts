import type { FirmwareSource, FlashImage } from "@replicas/core";
import { FlashImageValidator, type FlashExpectations } from "@replicas/firmware";

/** An image held in memory, held to the same validation as one read from a file. */
export class InMemoryFirmwareSource implements FirmwareSource {
  constructor(
    private readonly held: { readonly bytes: Uint8Array; readonly expectations: FlashExpectations },
  ) {}

  async image(): Promise<FlashImage> {
    const image: FlashImage = { bytes: this.held.bytes, offset: 0 };
    FlashImageValidator.require({ image, expectations: this.held.expectations });
    return image;
  }
}
