import type { Socket } from "node:net";
import tls from "node:tls";
import { Aedes } from "aedes";
import type { CertificateAuthority, MqttPeer } from "@replicas/core";
import type { ListeningAddress } from "./tls-hello-listener";

const LOOPBACK = "127.0.0.1";
const ANY_PORT = 0;
const MAX_CLIENT_ID_LENGTH = 256;
const SYSTEM_TOPIC_PREFIX = "$SYS";

/**
 * An MQTT broker over TLS inside the test process. Its certificate for each name comes from the per-run
 * certificate authority, so a device that trusts that authority completes the handshake and one that does not
 * is refused before any MQTT byte. Clients are anonymous; every publish a client makes is recorded.
 */
export class InProcessMqttBroker implements MqttPeer {
  private connectCount = 0;
  private readonly names: string[] = [];
  private readonly clientErrors: string[] = [];
  private readonly messages: { topic: string; payload: Uint8Array }[] = [];
  private readonly issued = new Map<string, tls.SecureContext>();
  private readonly sockets = new Set<Socket>();
  private readonly server: tls.Server;

  private constructor(
    private readonly authority: CertificateAuthority,
    private readonly broker: Aedes,
  ) {
    this.broker.on("client", () => (this.connectCount += 1));
    this.broker.on("publish", (packet, client) => {
      if (client && !packet.topic.startsWith(SYSTEM_TOPIC_PREFIX)) this.messages.push({ topic: packet.topic, payload: new Uint8Array(Buffer.from(packet.payload)) });
    });
    this.server = tls.createServer({ SNICallback: (name, answer) => this.onHello({ name, answer }) }, (socket) => this.broker.handle(socket));
    this.server.on("tlsClientError", (error) => this.clientErrors.push(error.message));
    this.server.on("connection", (socket: Socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  static async serving(authority: CertificateAuthority): Promise<InProcessMqttBroker> {
    return new InProcessMqttBroker(authority, await Aedes.createBroker({ maxClientsIdLength: MAX_CLIENT_ID_LENGTH }));
  }

  get connects(): number {
    return this.connectCount;
  }

  get published(): readonly { readonly topic: string; readonly payload: Uint8Array }[] {
    return [...this.messages];
  }

  /** Why each handshake a client abandoned or failed ended, as the TLS layer said it. */
  get tlsClientErrors(): readonly string[] {
    return [...this.clientErrors];
  }

  get recordedServerNames(): readonly string[] {
    return [...this.names];
  }

  listen(): Promise<ListeningAddress> {
    return new Promise((resolve) => {
      this.server.listen(ANY_PORT, LOOPBACK, () => {
        const address = this.server.address();
        resolve({ host: LOOPBACK, port: typeof address === "object" && address ? address.port : ANY_PORT });
      });
    });
  }

  async close(): Promise<void> {
    this.sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await new Promise<void>((resolve) => this.broker.close(() => resolve()));
  }

  private onHello(args: { name: string; answer: (error: Error | null, context?: tls.SecureContext) => void }): void {
    this.names.push(args.name);
    const known = this.issued.get(args.name);
    if (known) {
      args.answer(null, known);
      return;
    }
    const issued = this.authority.issue(args.name);
    const context = tls.createSecureContext({ cert: issued.certificatePem, key: issued.keyPem });
    this.issued.set(args.name, context);
    args.answer(null, context);
  }
}
