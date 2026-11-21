import { describe, expect, it } from "vitest";
import { NetworkRelay } from "@replicas/cli";
import { FakeGuestNetwork } from "../fakes/fake-guest-network";
import { FakeGuestRadio } from "../fakes/fake-guest-radio";

describe("NetworkRelay", () => {
  it("answers a mapped name, and refuses an unmapped one by an unresolved answer", async () => {
    const radio = new FakeGuestRadio();
    radio.requests = [{ kind: "resolve", id: 1, name: "known.test" }, { kind: "resolve", id: 2, name: "other.test" }];
    await new NetworkRelay(radio, new FakeGuestNetwork([])).pump();
    expect(radio.answers).toEqual([{ kind: "resolved", id: 1, addresses: ["203.0.113.1"] }, { kind: "unresolved", id: 2 }]);
  });

  it("opens a flow, sends the guest's bytes with credit back, and delivers what arrives", async () => {
    const radio = new FakeGuestRadio();
    const network = new FakeGuestNetwork([{ kind: "data", bytes: Uint8Array.from([9, 9]) }, { kind: "eof" }]);
    const relay = new NetworkRelay(radio, network);
    radio.requests = [{ kind: "connect", id: 5, address: "203.0.113.1", port: 8883 }];
    await relay.pump();
    radio.requests = [{ kind: "data", id: 5, bytes: Uint8Array.from([1, 2, 3]) }];
    await relay.pump();
    await relay.pump();
    expect(network.sent).toEqual([Uint8Array.from([1, 2, 3])]);
    expect(radio.answers.map((answer) => answer.kind)).toEqual(["connected", "credit", "data", "eof"]);
  });

  it("refuses a flow to an address the network does not carry", async () => {
    const radio = new FakeGuestRadio();
    radio.requests = [{ kind: "connect", id: 6, address: "198.51.100.7", port: 53 }];
    await new NetworkRelay(radio, new FakeGuestNetwork([])).pump();
    expect(radio.answers).toEqual([{ kind: "refused", id: 6 }]);
  });
});
