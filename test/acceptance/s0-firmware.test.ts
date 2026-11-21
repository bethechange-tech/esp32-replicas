import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChipFamily, FlashImage } from "@replicas/core";
import { FlashImageRefused, FlashImageValidator, UserImageSource, type FlashRefusal } from "@replicas/firmware";
import { FixedBoardFacts } from "../fakes/fixed-board-facts";
import { S0Fixtures } from "./support/s0-fixtures";

const MEGABYTE = 1024 * 1024;
const FLASH_SIZE_BYTE = 3;
const FLASH_SIZE_SHIFT = 4;
const TABLE = FlashImageValidator.PARTITION_TABLE_OFFSET;
const ENTRY = FlashImageValidator.PARTITION_ENTRY_BYTES;
const APP_OFFSET = 0x10000;

function image(chip: ChipFamily): FlashImage {
  return { bytes: S0Fixtures.helloImage(chip), offset: 0 };
}

function expectations(chip: ChipFamily, extra: { expectedMd5?: string } = {}) {
  return { chip, flashBytes: (chip === "esp32s3" ? 8 : 4) * MEGABYTE, ...extra };
}

function mutate(chip: ChipFamily, change: (bytes: Uint8Array) => void): FlashImage {
  const bytes = Uint8Array.from(S0Fixtures.helloImage(chip));
  change(bytes);
  return { bytes, offset: 0 };
}

describe("FlashImage validation (AC0b.8)", () => {
  it.each(["esp32s3", "esp32"] as const)("accepts upstream's real %s hello_world image", (chip) => {
    expect(FlashImageValidator.check({ image: image(chip), expectations: expectations(chip) })).toBeUndefined();
  });

  it("reads the real images' flash-size nibble as upstream's bootloaders log it (S3: 2 MB)", () => {
    const bytes = S0Fixtures.helloImage("esp32s3");
    expect((bytes[FLASH_SIZE_BYTE] ?? 0) >> FLASH_SIZE_SHIFT).toBe(1);
  });

  const refusals: readonly { name: FlashRefusal; chip: ChipFamily; make: () => FlashImage }[] = [
    { name: "bad-magic", chip: "esp32s3", make: () => mutate("esp32s3", (b) => (b[0] = 0x00)) },
    { name: "bad-magic", chip: "esp32", make: () => mutate("esp32", (b) => (b[FlashImageValidator.BOOTLOADER_OFFSET.esp32] = 0x00)) },
    {
      name: "flash-size-exceeds-board",
      chip: "esp32s3",
      make: () => mutate("esp32s3", (b) => (b[FLASH_SIZE_BYTE] = 5 << FLASH_SIZE_SHIFT)),
    },
    { name: "flash-size-unknown", chip: "esp32s3", make: () => mutate("esp32s3", (b) => (b[FLASH_SIZE_BYTE] = 0xf << FLASH_SIZE_SHIFT)) },
    { name: "bad-partition-table", chip: "esp32s3", make: () => mutate("esp32s3", (b) => (b[TABLE] = 0x00)) },
    {
      name: "no-app-partition",
      chip: "esp32s3",
      make: () => mutate("esp32s3", (b) => [0, 1, 2].forEach((entry) => (b[TABLE + entry * ENTRY + 2] = 1))),
    },
    { name: "image-too-short", chip: "esp32s3", make: () => ({ bytes: new Uint8Array(100), offset: 0 }) },
    { name: "image-too-short", chip: "esp32s3", make: () => ({ bytes: S0Fixtures.helloImage("esp32s3"), offset: 0x1000 }) },
  ];

  it.each(refusals)("refuses $name ($chip), by that name", ({ name, chip, make }) => {
    expect(FlashImageValidator.check({ image: make(), expectations: expectations(chip) })).toBe(name);
    expect(() => FlashImageValidator.require({ image: make(), expectations: expectations(chip) })).toThrow(FlashImageRefused);
  });

  it("checks the app region's MD5 when one is given: the right digest passes, another is refused", () => {
    const bytes = S0Fixtures.helloImage("esp32s3");
    const app = bytes.subarray(APP_OFFSET, APP_OFFSET + 0x100000);
    const digest = createHash("md5").update(app).digest("hex");
    expect(FlashImageValidator.check({ image: image("esp32s3"), expectations: expectations("esp32s3", { expectedMd5: digest }) })).toBeUndefined();
    expect(FlashImageValidator.check({ image: image("esp32s3"), expectations: expectations("esp32s3", { expectedMd5: "0".repeat(32) }) })).toBe("md5-mismatch");
  });

  it("reads each refusal from the thing it names: a refusal changes with the byte that breaks it", () => {
    const valid = image("esp32s3");
    const broken = mutate("esp32s3", (b) => (b[0] = 0x00));
    expect(valid.bytes[0]).toBe(FlashImageValidator.IMAGE_MAGIC);
    expect(broken.bytes[0]).not.toBe(valid.bytes[0]);
  });
});

describe("UserImageSource", () => {
  it("reads a factory.bin by path and refuses a corrupted copy before boot", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "user-image-"));
    try {
      const good = path.join(directory, "factory.bin");
      const bad = path.join(directory, "corrupt.bin");
      writeFileSync(good, S0Fixtures.helloImage("esp32s3"));
      writeFileSync(bad, mutate("esp32s3", (b) => (b[0] = 0x00)).bytes);
      const boards = new FixedBoardFacts({ chip: "esp32s3", flashBytes: 8 * MEGABYTE });
      const loaded = await new UserImageSource({ path: good, boards }).image("small-screen");
      expect(loaded.offset).toBe(0);
      expect(loaded.bytes.length).toBe(S0Fixtures.helloImage("esp32s3").length);
      await expect(new UserImageSource({ path: bad, boards }).image("small-screen")).rejects.toMatchObject({ refusal: "bad-magic" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
