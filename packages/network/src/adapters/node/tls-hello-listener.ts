import type { Socket } from "node:net";
import tls from "node:tls";
import type { CertificateAuthority, TlsPeer } from "@replicas/core";

export interface ListeningAddress {
  readonly host: string;
  readonly port: number;
}

const LOOPBACK = "127.0.0.1";
const ANY_PORT = 0;

/**
 * The broker end of a TLS check. It records the server name in each ClientHello. Refusing, it then fails the
 * handshake, so no application byte can arrive; completing, it answers with a certificate the per-run
 * certificate authority issues for that name.
 */
export class TlsHelloListener implements TlsPeer {
  private readonly names: string[] = [];
  private bytes = 0;
  private readonly sockets = new Set<Socket>();
  private readonly drainWaiters: (() => void)[] = [];
  private readonly server: tls.Server;

  private constructor(private readonly authority: CertificateAuthority | undefined) {
    this.server = tls.createServer({ SNICallback: (name, answer) => this.onHello({ name, answer }) }, (socket) => {
      socket.on("data", (chunk: Buffer) => (this.bytes += chunk.length));
      socket.on("error", () => undefined);
    });
    this.server.on("tlsClientError", () => undefined);
    this.server.on("connection", (socket: Socket) => this.track(socket));
  }

  static refusing(): TlsHelloListener {
    return new TlsHelloListener(undefined);
  }

  static completingWith(authority: CertificateAuthority): TlsHelloListener {
    return new TlsHelloListener(authority);
  }

  get recordedServerNames(): readonly string[] {
    return [...this.names];
  }

  get applicationBytes(): number {
    return this.bytes;
  }

  listen(): Promise<ListeningAddress> {
    return new Promise((resolve) => {
      this.server.listen(ANY_PORT, LOOPBACK, () => {
        const address = this.server.address();
        resolve({ host: LOOPBACK, port: typeof address === "object" && address ? address.port : ANY_PORT });
      });
    });
  }

  /** Resolves once every connection has closed, so a test reads the byte count after the last byte arrived. */
  drained(): Promise<void> {
    if (this.sockets.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      this.sockets.forEach((socket) => socket.destroy());
    });
  }

  private onHello(args: { name: string; answer: (error: Error | null, context?: tls.SecureContext) => void }): void {
    this.names.push(args.name);
    if (!this.authority) {
      args.answer(new Error("refused: this listener completes no handshake"));
      return;
    }
    const issued = this.authority.issue(args.name);
    args.answer(null, tls.createSecureContext({ cert: issued.certificatePem, key: issued.keyPem }));
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => {
      this.sockets.delete(socket);
      if (this.sockets.size === 0) this.drainWaiters.splice(0).forEach((resolve) => resolve());
    });
  }
}
