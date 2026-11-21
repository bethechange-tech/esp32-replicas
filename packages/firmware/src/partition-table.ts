import type { FlashImage } from "@replicas/core";

export class PartitionNotFound extends Error {
  constructor(name: string) {
    super(`the image's partition table has no partition named ${name}`);
  }
}

export interface PartitionPlace {
  readonly offset: number;
  readonly size: number;
}

/** Finds a partition by name in the table at 0x8000 of a whole flash image (entry layout: ESP-IDF gen_esp32part.py). */
export class PartitionTable {
  private static readonly TABLE_OFFSET = 0x8000;
  private static readonly TABLE_BYTES = 0x1000;
  private static readonly ENTRY_BYTES = 32;
  private static readonly ENTRY_MAGIC = 0x50aa;
  private static readonly OFFSET_FIELD = 4;
  private static readonly SIZE_FIELD = 8;
  private static readonly NAME_FIELD = 12;
  private static readonly NAME_BYTES = 16;

  private constructor() {}

  static find(args: { image: FlashImage; name: string }): PartitionPlace {
    const { bytes } = args.image;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = PartitionTable.TABLE_OFFSET; at < PartitionTable.TABLE_OFFSET + PartitionTable.TABLE_BYTES; at += PartitionTable.ENTRY_BYTES) {
      if (view.getUint16(at, true) !== PartitionTable.ENTRY_MAGIC) break;
      if (PartitionTable.nameAt({ bytes, at }) === args.name) {
        return { offset: view.getUint32(at + PartitionTable.OFFSET_FIELD, true), size: view.getUint32(at + PartitionTable.SIZE_FIELD, true) };
      }
    }
    throw new PartitionNotFound(args.name);
  }

  private static nameAt(args: { bytes: Uint8Array; at: number }): string {
    const field = args.bytes.subarray(args.at + PartitionTable.NAME_FIELD, args.at + PartitionTable.NAME_FIELD + PartitionTable.NAME_BYTES);
    const end = field.indexOf(0);
    return new TextDecoder().decode(end < 0 ? field : field.subarray(0, end));
  }
}
