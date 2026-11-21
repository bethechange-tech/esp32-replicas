import { describe, expect, it } from "vitest";
import { PartitionNotFound, PartitionTable } from "./partition-table";

const TABLE_OFFSET = 0x8000;

function image(entries: readonly { name: string; offset: number; size: number }[]): Uint8Array {
  const bytes = new Uint8Array(TABLE_OFFSET + 0x1000).fill(0xff);
  const view = new DataView(bytes.buffer);
  entries.forEach((entry, index) => {
    const at = TABLE_OFFSET + index * 32;
    view.setUint16(at, 0x50aa, true);
    view.setUint32(at + 4, entry.offset, true);
    view.setUint32(at + 8, entry.size, true);
    bytes.fill(0, at + 12, at + 28);
    bytes.set(new TextEncoder().encode(entry.name), at + 12);
  });
  return bytes;
}

describe("PartitionTable", () => {
  it("finds a partition by name", () => {
    const bytes = image([{ name: "nvs", offset: 0x9000, size: 0x5000 }, { name: "replica_ca", offset: 0x610000, size: 0x2000 }]);
    expect(PartitionTable.find({ image: { bytes, offset: 0 }, name: "replica_ca" })).toEqual({ offset: 0x610000, size: 0x2000 });
  });

  it("refuses a name that is not in the table, by name", () => {
    expect(() => PartitionTable.find({ image: { bytes: image([]), offset: 0 }, name: "replica_ca" })).toThrow(PartitionNotFound);
  });
});
