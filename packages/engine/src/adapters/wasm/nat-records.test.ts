import { describe, expect, it } from "vitest";
import { EventKind, NatRecords } from "./nat-records";

function record(args: { op: number; flags?: number; port?: number; id: number; data?: number[] }): number[] {
  const data = args.data ?? [];
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setUint8(0, args.op);
  view.setUint8(1, args.flags ?? 0);
  view.setUint16(2, args.port ?? 0, true);
  view.setUint32(4, args.id, true);
  view.setUint32(8, data.length, true);
  const padding = (4 - (data.length % 4)) % 4;
  return [...header, ...data, ...Array<number>(padding).fill(0)];
}

describe("NatRecords", () => {
  it("reads connect, data, close and resolve records, each padded to four bytes", () => {
    const bytes = Uint8Array.from([
      ...record({ op: 1, port: 8883, id: 7, data: [203, 0, 113, 1] }),
      ...record({ op: 2, id: 7, data: [1, 2, 3] }),
      ...record({ op: 4, flags: 1, id: 7 }),
      ...record({ op: 8, port: 1, id: 9, data: [...new TextEncoder().encode("broker.replica.test")] }),
    ]);
    expect(NatRecords.parse(bytes)).toEqual([
      { kind: "connect", id: 7, address: "203.0.113.1", port: 8883 },
      { kind: "data", id: 7, bytes: Uint8Array.from([1, 2, 3]) },
      { kind: "close", id: 7, abort: true },
      { kind: "resolve", id: 9, name: "broker.replica.test" },
    ]);
  });

  it("encodes the answers as the engine's event kinds", () => {
    expect(NatRecords.encode({ kind: "connected", id: 1, credit: 100 })).toMatchObject({ kind: EventKind.CONNECTED, arg: 100 });
    expect(NatRecords.encode({ kind: "resolved", id: 2, addresses: ["203.0.113.1"] }).bytes).toEqual(Uint8Array.from([203, 0, 113, 1]));
    expect(NatRecords.encode({ kind: "unresolved", id: 2 }).kind).toBe(EventKind.UNRESOLVED);
    expect(NatRecords.encode({ kind: "refused", id: 3 }).kind).toBe(EventKind.FAILED);
  });
});
