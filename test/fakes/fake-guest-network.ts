import type { GuestFlow, GuestNetwork, NetworkEvent } from "@replicas/core";

/** A network that knows one name and one address, sends nothing anywhere and plays back the events it was given. */
export class FakeGuestNetwork implements GuestNetwork {
  readonly sent: Uint8Array[] = [];
  constructor(private readonly incoming: NetworkEvent[]) {}
  async resolve(name: string): Promise<string | undefined> {
    return name === "known.test" ? "203.0.113.1" : undefined;
  }
  async open(flow: GuestFlow): Promise<AsyncIterable<NetworkEvent> | undefined> {
    if (flow.address !== "203.0.113.1") return undefined;
    const events = this.incoming;
    return (async function* () {
      yield { kind: "connected" } as const;
      yield* events;
    })();
  }
  send(args: { bytes: Uint8Array }): void {
    this.sent.push(args.bytes);
  }
  refusals(): never[] {
    return [];
  }
  async close(): Promise<void> {}
}
