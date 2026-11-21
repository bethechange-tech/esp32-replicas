import { setImmediate as nextTurn } from "node:timers/promises";
import type { FlowRequest, GuestFlow, GuestNetwork, GuestRadio, NetworkEvent } from "@replicas/core";

/** Bytes the host takes from the guest on a new flow before the first credit comes back. */
const FLOW_WINDOW_BYTES = 32_768;

interface OpenFlow {
  readonly flow: GuestFlow;
  readonly inbox: NetworkEvent[];
}

/** Joins the engine's relay to a `GuestNetwork`: the guest's names and flows go out, the answers come back at the next pump. */
export class NetworkRelay {
  private readonly flows = new Map<number, OpenFlow>();

  constructor(
    private readonly radio: GuestRadio,
    private readonly network: GuestNetwork,
  ) {}

  /** Handle what the guest asked since the last pump, offer it what has arrived, and let local sockets take a turn. */
  async pump(): Promise<void> {
    for (const request of this.radio.takeFlowRequests()) await this.handle(request);
    this.deliver();
    await nextTurn();
  }

  private async handle(request: FlowRequest): Promise<void> {
    switch (request.kind) {
      case "resolve":
        return this.resolve({ id: request.id, name: request.name });
      case "connect":
        return this.connect({ id: request.id, flow: { protocol: "tcp", address: request.address, port: request.port } });
      case "data":
        return this.send({ id: request.id, bytes: request.bytes });
      case "close":
        this.flows.delete(request.id);
        return;
      case "shutdown":
      case "datagram":
        return;
    }
  }

  private async resolve(args: { id: number; name: string }): Promise<void> {
    const address = await this.network.resolve(args.name);
    this.radio.answer(address ? { kind: "resolved", id: args.id, addresses: [address] } : { kind: "unresolved", id: args.id });
  }

  private async connect(args: { id: number; flow: GuestFlow }): Promise<void> {
    const events = await this.network.open(args.flow);
    if (!events) {
      this.radio.answer({ kind: "refused", id: args.id });
      return;
    }
    const open: OpenFlow = { flow: args.flow, inbox: [] };
    this.flows.set(args.id, open);
    this.radio.answer({ kind: "connected", id: args.id, credit: FLOW_WINDOW_BYTES });
    void this.collect({ events, open });
  }

  private send(args: { id: number; bytes: Uint8Array }): void {
    const open = this.flows.get(args.id);
    if (!open) return;
    this.network.send({ flow: open.flow, bytes: args.bytes });
    this.radio.answer({ kind: "credit", id: args.id, bytes: args.bytes.length });
  }

  private async collect(args: { events: AsyncIterable<NetworkEvent>; open: OpenFlow }): Promise<void> {
    for await (const event of args.events) {
      if (event.kind !== "connected") args.open.inbox.push(event);
    }
  }

  private deliver(): void {
    for (const [id, open] of this.flows) {
      while (open.inbox.length > 0) {
        const event = open.inbox[0];
        if (!event || !this.offer({ id, open, event })) break;
        open.inbox.shift();
      }
    }
  }

  /** True when the event was taken whole; a data event the guest took only part of stays at the head, shortened. */
  private offer(args: { id: number; open: OpenFlow; event: NetworkEvent }): boolean {
    const { id, event } = args;
    if (event.kind !== "data") {
      if (event.kind !== "connected") this.radio.answer({ kind: event.kind, id });
      return true;
    }
    const taken = this.radio.answer({ kind: "data", id, bytes: event.bytes });
    if (taken >= event.bytes.length) return true;
    args.open.inbox[0] = { kind: "data", bytes: event.bytes.slice(taken) };
    return false;
  }
}
