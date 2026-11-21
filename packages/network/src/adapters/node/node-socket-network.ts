import net from "node:net";
import type { GuestFlow, GuestNetwork, NetworkEvent, NetworkRefusal } from "@replicas/core";

export interface LocalEndpoint {
  readonly host: string;
  readonly port: number;
}

/** Documentation range 203.0.113.0/24 (RFC 5737, TEST-NET-3): an address that is never a real host. */
const TEST_NET_3_PREFIX = "203.0.113.";
const FIRST_HOST = 1;
const LAST_HOST = 254;

/** Events of one flow, queued from the socket's own callbacks so none is lost before a reader arrives. */
class FlowEvents implements AsyncIterable<NetworkEvent> {
  private readonly queue: NetworkEvent[] = [{ kind: "connected" }];
  private wake: (() => void) | undefined;
  private finished = false;

  push(event: NetworkEvent): void {
    if (this.finished) return;
    this.queue.push(event);
    if (event.kind === "eof" || event.kind === "reset") this.finished = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<NetworkEvent> {
    for (;;) {
      const next = this.queue.shift();
      if (next) yield next;
      else if (this.finished) return;
      else await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

/**
 * Carries the guest's flows to local listeners. A name is answered only when it is mapped, with an address in
 * TEST-NET-3; a flow is carried only to such an address. Nothing else leaves the machine.
 */
export class NodeSocketNetwork implements GuestNetwork {
  private readonly addressOf = new Map<string, string>();
  private readonly endpointOf = new Map<string, LocalEndpoint>();
  private readonly sockets = new Map<string, net.Socket>();
  private readonly refused: NetworkRefusal[] = [];

  constructor(names: Readonly<Record<string, LocalEndpoint>>) {
    Object.entries(names).forEach(([name, endpoint], index) => {
      const host = FIRST_HOST + index;
      if (host > LAST_HOST) throw new RangeError("more mapped names than TEST-NET-3 holds");
      const address = `${TEST_NET_3_PREFIX}${host}`;
      this.addressOf.set(name.toLowerCase(), address);
      this.endpointOf.set(address, endpoint);
    });
  }

  async resolve(name: string): Promise<string | undefined> {
    const address = this.addressOf.get(name.toLowerCase());
    if (!address) this.refused.push({ subject: name, reason: "unmapped-name" });
    return address;
  }

  async open(flow: GuestFlow): Promise<AsyncIterable<NetworkEvent> | undefined> {
    const endpoint = this.endpointOf.get(flow.address);
    if (!endpoint) return this.refuse({ subject: NodeSocketNetwork.key(flow), reason: "unknown-address" });
    if (flow.protocol !== "tcp") return this.refuse({ subject: NodeSocketNetwork.key(flow), reason: "unsupported-protocol" });
    const events = new FlowEvents();
    const socket = await this.connect({ endpoint, events });
    if (!socket) return this.refuse({ subject: NodeSocketNetwork.key(flow), reason: "unreachable" });
    this.sockets.set(NodeSocketNetwork.key(flow), socket);
    return events;
  }

  send(args: { flow: GuestFlow; bytes: Uint8Array }): void {
    const socket = this.sockets.get(NodeSocketNetwork.key(args.flow));
    if (!socket) {
      this.refused.push({ subject: NodeSocketNetwork.key(args.flow), reason: "unknown-address" });
      return;
    }
    socket.write(args.bytes);
  }

  refusals(): readonly NetworkRefusal[] {
    return [...this.refused];
  }

  async close(): Promise<void> {
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear();
  }

  private connect(args: { endpoint: LocalEndpoint; events: FlowEvents }): Promise<net.Socket | undefined> {
    return new Promise((resolve) => {
      const socket = net.connect({ host: args.endpoint.host, port: args.endpoint.port });
      socket.once("connect", () => resolve(socket));
      socket.once("error", () => {
        args.events.push({ kind: "reset" });
        resolve(undefined);
      });
      socket.on("data", (chunk: Buffer) => args.events.push({ kind: "data", bytes: new Uint8Array(chunk) }));
      socket.on("end", () => args.events.push({ kind: "eof" }));
      socket.on("close", () => args.events.push({ kind: "reset" }));
    });
  }

  private refuse(refusal: NetworkRefusal): undefined {
    this.refused.push(refusal);
    return undefined;
  }

  private static key(flow: GuestFlow): string {
    return `${flow.protocol}:${flow.address}:${flow.port}`;
  }
}
