import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DirectoryRomSource, RomRefused } from "./directory-rom-source";

describe("DirectoryRomSource", () => {
  it("refuses a ROM that is not in the directory, by file name, and says how to fetch it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "roms-"));
    try {
      expect(() => new DirectoryRomSource(directory).rom("esp32s3")).toThrow(RomRefused);
      expect(() => new DirectoryRomSource(directory).rom("esp32s3")).toThrow(/esp32s3_rev0_rom\.elf.*pnpm fetch:roms/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses a file whose SHA-256 is not the pinned one", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "roms-"));
    try {
      writeFileSync(path.join(directory, DirectoryRomSource.PINNED.esp32.file), "not a ROM");
      expect(() => new DirectoryRomSource(directory).rom("esp32")).toThrow(/SHA-256/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins each chip to the ROM upstream's fetch script pins, read from that script", () => {
    const script = readFileSync(path.resolve(import.meta.dirname, "../../../../../third_party/esp32sim/tools/fetch-rom-elfs.sh"), "utf8");
    for (const pinned of Object.values(DirectoryRomSource.PINNED)) {
      expect(script).toContain(`${pinned.file} ${pinned.sha256}`);
    }
  });
});
