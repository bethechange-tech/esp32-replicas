import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { NetworkEvent } from "@replicas/core";
import { NodeSocketNetwork } from "@replicas/network";

const MAPPED = "broker.replica.test";
const TEST_NET_3 = /^203\.0\.113\.\d{1,3}$/;

function echoServer(): Promise<{ port: number; close: () => Promise<void>; received: Buffer[] }> {
  const received: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => {
      received.push(chunk);
      socket.write(Buffer.concat([Buffer.from("echo:"), chunk]));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        received,
        close: () => new Promise<void>((done) => (server.close(() => done()), sockets.forEach((socket) => socket.destroy()))),
      });
    });
  });
}

async function take(events: AsyncIterable<NetworkEvent>, count: number): Promise<NetworkEvent[]> {
  const taken: NetworkEvent[] = [];
  for await (const event of events) {
    taken.push(event);
    if (taken.length === count) break;
  }
  return taken;
}

describe("NodeSocketNetwork (AC0b.7)", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("answers a mapped name with a TEST-NET-3 address and carries the flow to the local listener", async () => {
    const listener = await echoServer();
    const network = new NodeSocketNetwork({ [MAPPED]: { host: "127.0.0.1", port: listener.port } });
    closers.push(() => network.close(), listener.close);
    const address = await network.resolve(MAPPED);
    expect(address).toMatch(TEST_NET_3);
    const flow = { protocol: "tcp", address: address ?? "", port: 8883 } as const;
    const events = await network.open(flow);
    expect(events).toBeDefined();
    network.send({ flow, bytes: new Uint8Array([1, 2, 3]) });
    const taken = await take(events ?? (async function* () {})(), 2);
    expect(taken[0]).toEqual({ kind: "connected" });
    expect(taken[1]?.kind).toBe("data");
    expect(Buffer.concat(listener.received)).toEqual(Buffer.from([1, 2, 3]));
    expect(network.refusals()).toEqual([]);
  });

  it("finishes a flow's events when the connection closes without an orderly end", async () => {
    const listener = await echoServer();
    const network = new NodeSocketNetwork({ [MAPPED]: { host: "127.0.0.1", port: listener.port } });
    closers.push(listener.close);
    const flow = { protocol: "tcp", address: (await network.resolve(MAPPED)) ?? "", port: 8883 } as const;
    const events = await network.open(flow);
    await network.close();
    const kinds: string[] = [];
    for await (const event of events ?? (async function* () {})()) kinds.push(event.kind);
    expect(kinds).toEqual(["connected", "reset"]);
  });

  it("answers the same name the same way, and names are case-insensitive", async () => {
    const network = new NodeSocketNetwork({ [MAPPED]: { host: "127.0.0.1", port: 1 } });
    expect(await network.resolve(MAPPED.toUpperCase())).toBe(await network.resolve(MAPPED));
  });

  it("refuses an unmapped name, asserted as a refusal by that name and reason", async () => {
    const network = new NodeSocketNetwork({ [MAPPED]: { host: "127.0.0.1", port: 1 } });
    expect(await network.resolve("example.org")).toBeUndefined();
    expect(network.refusals()).toEqual([{ subject: "example.org", reason: "unmapped-name" }]);
  });

  it("refuses a flow to an address it never handed out, and a UDP flow to one it did", async () => {
    const network = new NodeSocketNetwork({ [MAPPED]: { host: "127.0.0.1", port: 1 } });
    const address = (await network.resolve(MAPPED)) ?? "";
    expect(await network.open({ protocol: "tcp", address: "198.51.100.9", port: 1 })).toBeUndefined();
    expect(await network.open({ protocol: "udp", address, port: 1 })).toBeUndefined();
    expect(network.refusals().map((r) => r.reason)).toEqual(["unknown-address", "unsupported-protocol"]);
  });

  it("refuses a flow whose listener is not there, as unreachable", async () => {
    const dead = await echoServer();
    await dead.close();
    const network = new NodeSocketNetwork({ [MAPPED]: { host: "127.0.0.1", port: dead.port } });
    const address = (await network.resolve(MAPPED)) ?? "";
    expect(await network.open({ protocol: "tcp", address, port: 8883 })).toBeUndefined();
    expect(network.refusals().map((r) => r.reason)).toEqual(["unreachable"]);
  });
});
