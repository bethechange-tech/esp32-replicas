import type { ChipFamily, RomSource } from "@replicas/core";

export class InMemoryRomSource implements RomSource {
  constructor(private readonly roms: Readonly<Record<ChipFamily, Uint8Array>>) {}

  rom(chip: ChipFamily): Uint8Array {
    return this.roms[chip];
  }
}
