import type { GuestFlow, GuestNetwork, NetworkEvent, NetworkRefusal } from "@replicas/core";

/** Refuses every name and every flow: the browser, and tests that must see no traffic. */
export class OfflineNetwork implements GuestNetwork {
  private readonly refused: NetworkRefusal[] = [];

  async resolve(name: string): Promise<string | undefined> {
    this.refused.push({ subject: name, reason: "offline" });
    return undefined;
  }

  async open(flow: GuestFlow): Promise<AsyncIterable<NetworkEvent> | undefined> {
    this.refused.push({ subject: `${flow.protocol}:${flow.address}:${flow.port}`, reason: "offline" });
    return undefined;
  }

  send(args: { flow: GuestFlow; bytes: Uint8Array }): void {
    this.refused.push({ subject: `${args.flow.protocol}:${args.flow.address}:${args.flow.port}`, reason: "offline" });
  }

  refusals(): readonly NetworkRefusal[] {
    return [...this.refused];
  }

  async close(): Promise<void> {}
}
