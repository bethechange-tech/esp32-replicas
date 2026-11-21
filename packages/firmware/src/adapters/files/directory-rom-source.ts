import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChipFamily, RomSource } from "@replicas/core";

export class RomRefused extends Error {
  constructor(args: { file: string; reason: string }) {
    super(`${args.file}: ${args.reason}`);
  }
}

interface PinnedRom {
  readonly file: string;
  readonly sha256: string;
}

/**
 * Reads the mask ROM ELFs that `pnpm fetch:roms` downloads (Apache-2.0, espressif/esp-rom-elfs 20260528),
 * refusing any file whose SHA-256 is not the pinned one. The pins are the ones in esp32sim's
 * tools/fetch-rom-elfs.sh at the vendored commit.
 */
export class DirectoryRomSource implements RomSource {
  static readonly PINNED: Readonly<Record<ChipFamily, PinnedRom>> = {
    esp32s3: { file: "esp32s3_rev0_rom.elf", sha256: "c0ce0f338d1de1bdc6efbef1591779a2a42c1ab7d759d3c6ae8ae63a7dd34cfd" },
    esp32: { file: "esp32_rev300_rom.elf", sha256: "920b70635440517866aab2230964a570d2cf2b676658d93c52fbac108c1cca31" },
  };

  constructor(private readonly directory: string) {}

  rom(chip: ChipFamily): Uint8Array {
    const pinned = DirectoryRomSource.PINNED[chip];
    const bytes = this.readOrRefuse(pinned);
    if (createHash("sha256").update(bytes).digest("hex") !== pinned.sha256) {
      throw new RomRefused({ file: pinned.file, reason: "its SHA-256 is not the pinned one" });
    }
    return bytes;
  }

  private readOrRefuse(pinned: PinnedRom): Uint8Array {
    try {
      return readFileSync(path.join(this.directory, pinned.file));
    } catch {
      throw new RomRefused({ file: pinned.file, reason: "it is not in the ROM directory (run pnpm fetch:roms)" });
    }
  }
}
