import tls from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { TestCa } from "@replicas/firmware";
import { TlsHelloListener } from "./tls-hello-listener";

const SNI = "broker.replica.test";
/** node:tls checks certificates against the real clock, so the authority must issue on it. */
const REAL_CLOCK = { unixMilliseconds: (): number => Date.now() };

function clientHello(args: { port: number; ca?: string }): Promise<{ outcome: "secure" | "refused"; payload?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: "127.0.0.1", port: args.port, servername: SNI, ...(args.ca ? { ca: args.ca } : {}) });
    socket.once("secureConnect", () => {
      socket.write("hello");
      socket.end();
      resolve({ outcome: "secure", payload: "hello" });
    });
    socket.once("error", () => resolve({ outcome: "refused" }));
  });
}

describe("TlsHelloListener", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("records the server name of a client, refuses the handshake and reports zero application bytes", async () => {
    const listener = TlsHelloListener.refusing();
    closers.push(() => listener.close());
    const { port } = await listener.listen();
    const result = await clientHello({ port });
    expect(result.outcome).toBe("refused");
    expect(listener.recordedServerNames).toEqual([SNI]);
    expect(listener.applicationBytes).toBe(0);
  });

  it("completes with a certificate from the per-run authority when the client trusts it, and counts the bytes", async () => {
    const ca = new TestCa(REAL_CLOCK);
    const listener = TlsHelloListener.completingWith(ca);
    closers.push(() => listener.close());
    const { port } = await listener.listen();
    const result = await clientHello({ port, ca: ca.caPem });
    expect(result.outcome).toBe("secure");
    await listener.drained();
    expect(listener.recordedServerNames).toEqual([SNI]);
    expect(listener.applicationBytes).toBe("hello".length);
  });

  it("is refused by a client that trusts another authority, and then no application byte arrives", async () => {
    const ca = new TestCa(REAL_CLOCK);
    const stranger = new TestCa(REAL_CLOCK);
    const listener = TlsHelloListener.completingWith(ca);
    closers.push(() => listener.close());
    const { port } = await listener.listen();
    const result = await clientHello({ port, ca: stranger.caPem });
    expect(result.outcome).toBe("refused");
    expect(listener.recordedServerNames).toEqual([SNI]);
    expect(listener.applicationBytes).toBe(0);
  });
});
