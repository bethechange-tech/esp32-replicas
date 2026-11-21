import { createHash } from "node:crypto";
import type { ChipFamily, FlashImage } from "@replicas/core";

/** Why an image was refused. Each code is asserted by name. */
export type FlashRefusal =
  | "image-too-short"
  | "bad-magic"
  | "flash-size-unknown"
  | "flash-size-exceeds-board"
  | "bad-partition-table"
  | "no-app-partition"
  | "md5-mismatch";

export interface FlashExpectations {
  readonly chip: ChipFamily;
  readonly flashBytes: number;
  /** Lower-case hex MD5 of the first app partition's region. */
  readonly expectedMd5?: string;
}

export class FlashImageRefused extends Error {
  constructor(readonly refusal: FlashRefusal) {
    super(`the flash image was refused: ${refusal}`);
  }
}

interface Partition {
  readonly type: number;
  readonly offset: number;
  readonly size: number;
}

/**
 * Checks a whole flash image before boot. Layout from ESP-IDF: the image header magic
 * (`ESP_IMAGE_HEADER_MAGIC`) and flash-size nibble (`esp_image_header_t.spi_size`) in
 * components/bootloader_support/include/esp_app_format.h, and the partition entry format in
 * components/partition_table/gen_esp32part.py (entry magic 0xAA50, 32 bytes each, type 0 is an app).
 */
export class FlashImageValidator {
  static readonly IMAGE_MAGIC = 0xe9;
  static readonly PARTITION_TABLE_OFFSET = 0x8000;
  static readonly PARTITION_TABLE_BYTES = 0x1000;
  static readonly PARTITION_ENTRY_BYTES = 32;
  static readonly PARTITION_ENTRY_MAGIC = 0x50aa;
  static readonly APP_PARTITION_TYPE = 0;
  /** Where the second-stage bootloader sits: ESP32-S3 at 0x0, the classic ESP32 at 0x1000. */
  static readonly BOOTLOADER_OFFSET: Readonly<Record<ChipFamily, number>> = { esp32s3: 0x0, esp32: 0x1000 };
  /** `esp_image_header_t.spi_size` nibble to megabytes: 1, 2, 4, 8, 16, 32, 64, 128. */
  private static readonly FLASH_SIZE_NIBBLE_LIMIT = 7;
  private static readonly FLASH_SIZE_BYTE = 3;
  private static readonly FLASH_SIZE_SHIFT = 4;
  private static readonly BYTES_PER_MEGABYTE = 1_048_576;
  private static readonly TABLE_END_MAGIC = 0xffff;
  private static readonly PARTITION_ENTRY_MD5_MAGIC = 0xebeb;
  private static readonly PARTITION_OFFSET_FIELD = 4;
  private static readonly PARTITION_SIZE_FIELD = 8;

  private constructor() {}

  /** The refusal, or undefined when the image may boot. */
  static check(args: { image: FlashImage; expectations: FlashExpectations }): FlashRefusal | undefined {
    const { image, expectations } = args;
    const bytes = image.bytes;
    const header = FlashImageValidator.BOOTLOADER_OFFSET[expectations.chip];
    const tableEnd = FlashImageValidator.PARTITION_TABLE_OFFSET + FlashImageValidator.PARTITION_TABLE_BYTES;
    if (image.offset !== 0 || bytes.length < tableEnd) return "image-too-short";
    if (bytes[header] !== FlashImageValidator.IMAGE_MAGIC) return "bad-magic";
    const sizeNibble = (bytes[header + FlashImageValidator.FLASH_SIZE_BYTE] ?? 0) >> FlashImageValidator.FLASH_SIZE_SHIFT;
    if (sizeNibble > FlashImageValidator.FLASH_SIZE_NIBBLE_LIMIT) return "flash-size-unknown";
    if (FlashImageValidator.BYTES_PER_MEGABYTE << sizeNibble > expectations.flashBytes) return "flash-size-exceeds-board";
    const partitions = FlashImageValidator.partitions(bytes);
    if (!partitions) return "bad-partition-table";
    const app = partitions.find((partition) => partition.type === FlashImageValidator.APP_PARTITION_TYPE);
    if (!app) return "no-app-partition";
    return FlashImageValidator.md5Problem({ bytes, app, expected: expectations.expectedMd5 });
  }

  static require(args: { image: FlashImage; expectations: FlashExpectations }): void {
    const refusal = FlashImageValidator.check(args);
    if (refusal) throw new FlashImageRefused(refusal);
  }

  /** The entries of the table, or undefined when an entry's magic is neither an entry nor the end of the table. */
  private static partitions(bytes: Uint8Array): Partition[] | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const found: Partition[] = [];
    const start = FlashImageValidator.PARTITION_TABLE_OFFSET;
    for (let at = start; at < start + FlashImageValidator.PARTITION_TABLE_BYTES; at += FlashImageValidator.PARTITION_ENTRY_BYTES) {
      const magic = view.getUint16(at, true);
      if (magic === FlashImageValidator.TABLE_END_MAGIC || magic === FlashImageValidator.PARTITION_ENTRY_MD5_MAGIC) return found;
      if (magic !== FlashImageValidator.PARTITION_ENTRY_MAGIC) return undefined;
      found.push({
        type: view.getUint8(at + 2),
        offset: view.getUint32(at + FlashImageValidator.PARTITION_OFFSET_FIELD, true),
        size: view.getUint32(at + FlashImageValidator.PARTITION_SIZE_FIELD, true),
      });
    }
    return found;
  }

  private static md5Problem(args: { bytes: Uint8Array; app: Partition; expected: string | undefined }): FlashRefusal | undefined {
    if (args.expected === undefined) return undefined;
    const region = args.bytes.subarray(args.app.offset, args.app.offset + args.app.size);
    return createHash("md5").update(region).digest("hex") === args.expected.toLowerCase() ? undefined : "md5-mismatch";
  }
}
