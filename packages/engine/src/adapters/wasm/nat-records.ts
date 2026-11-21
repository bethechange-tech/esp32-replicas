import type { FlowAnswer, FlowRequest } from "@replicas/core";

const HEADER_BYTES = 12;
const PORT_OFFSET = 2;
const ID_OFFSET = 4;
const LENGTH_OFFSET = 8;
const FLAGS_OFFSET = 1;
const ALIGNMENT = 4;
const ABORT_FLAG = 1;
const IPV4_BYTES = 4;

/** Operation numbers of the records `esp32sim_nat_take` hands over (the doc comment of that export). */
class RecordOp {
  static readonly TCP_CONNECT = 1;
  static readonly TCP_DATA = 2;
  static readonly TCP_SHUTDOWN = 3;
  static readonly TCP_CLOSE = 4;
  static readonly UDP_OPEN = 5;
  static readonly UDP_DATA = 6;
  static readonly UDP_CLOSE = 7;
  static readonly RESOLVE = 8;

  private constructor() {}
}

/** Event kinds `esp32sim_nat_event` takes. */
export class EventKind {
  static readonly CONNECTED = 1;
  static readonly FAILED = 2;
  static readonly TCP_DATA = 3;
  static readonly TCP_EOF = 4;
  static readonly TCP_RESET = 5;
  static readonly TX_CREDIT = 6;
  static readonly RESOLVED = 8;
  static readonly UNRESOLVED = 9;

  private constructor() {}
}

const REFUSED_CODE = 1;
const NXDOMAIN = 3;
const DEFAULT_TTL = 60;

export interface EncodedEvent {
  readonly kind: number;
  readonly id: number;
  readonly arg: number;
  readonly bytes: Uint8Array;
}

/** The wire shapes of the engine's NAT relay, in one place: records out of the guest, events back into it. */
export class NatRecords {
  private constructor() {}

  static parse(bytes: Uint8Array): FlowRequest[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const requests: FlowRequest[] = [];
    for (let at = 0; at + HEADER_BYTES <= bytes.length; ) {
      const length = view.getUint32(at + LENGTH_OFFSET, true);
      const data = bytes.slice(at + HEADER_BYTES, at + HEADER_BYTES + length);
      const request = NatRecords.request({
        op: view.getUint8(at),
        flags: view.getUint8(at + FLAGS_OFFSET),
        port: view.getUint16(at + PORT_OFFSET, true),
        id: view.getUint32(at + ID_OFFSET, true),
        data,
      });
      if (request) requests.push(request);
      at += HEADER_BYTES + Math.ceil(length / ALIGNMENT) * ALIGNMENT;
    }
    return requests;
  }

  static encode(answer: FlowAnswer): EncodedEvent {
    const none = new Uint8Array(0);
    switch (answer.kind) {
      case "connected":
        return { kind: EventKind.CONNECTED, id: answer.id, arg: answer.credit, bytes: none };
      case "refused":
        return { kind: EventKind.FAILED, id: answer.id, arg: REFUSED_CODE, bytes: none };
      case "data":
        return { kind: EventKind.TCP_DATA, id: answer.id, arg: 0, bytes: answer.bytes };
      case "eof":
        return { kind: EventKind.TCP_EOF, id: answer.id, arg: 0, bytes: none };
      case "reset":
        return { kind: EventKind.TCP_RESET, id: answer.id, arg: 0, bytes: none };
      case "credit":
        return { kind: EventKind.TX_CREDIT, id: answer.id, arg: answer.bytes, bytes: none };
      case "resolved":
        return { kind: EventKind.RESOLVED, id: answer.id, arg: DEFAULT_TTL, bytes: NatRecords.addresses(answer.addresses) };
      case "unresolved":
        return { kind: EventKind.UNRESOLVED, id: answer.id, arg: NXDOMAIN, bytes: none };
    }
  }

  private static request(args: { op: number; flags: number; port: number; id: number; data: Uint8Array }): FlowRequest | undefined {
    switch (args.op) {
      case RecordOp.TCP_CONNECT:
        return { kind: "connect", id: args.id, port: args.port, address: Array.from(args.data.slice(0, IPV4_BYTES)).join(".") };
      case RecordOp.TCP_DATA:
        return { kind: "data", id: args.id, bytes: args.data };
      case RecordOp.TCP_SHUTDOWN:
        return { kind: "shutdown", id: args.id };
      case RecordOp.TCP_CLOSE:
        return { kind: "close", id: args.id, abort: (args.flags & ABORT_FLAG) !== 0 };
      case RecordOp.RESOLVE:
        return { kind: "resolve", id: args.id, name: new TextDecoder().decode(args.data) };
      case RecordOp.UDP_OPEN:
      case RecordOp.UDP_DATA:
      case RecordOp.UDP_CLOSE:
        return { kind: "datagram", id: args.id };
      default:
        return undefined;
    }
  }

  private static addresses(addresses: readonly string[]): Uint8Array {
    return Uint8Array.from(addresses.flatMap((address) => address.split(".").map(Number)));
  }
}
