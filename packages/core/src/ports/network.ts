export interface GuestFlow {
  readonly protocol: "tcp" | "udp";
  readonly address: string;
  readonly port: number;
}

export type NetworkEvent =
  | { readonly kind: "connected" }
  | { readonly kind: "data"; readonly bytes: Uint8Array }
  | { readonly kind: "eof" }
  | { readonly kind: "reset" };

/** A name or flow the network would not carry, kept so a refusal is asserted by name. */
export interface NetworkRefusal {
  readonly subject: string;
  readonly reason: "unmapped-name" | "unknown-address" | "unsupported-protocol" | "unreachable" | "offline";
}

export interface GuestNetwork {
  /** The address the guest is given for a name, or undefined when the name is refused. */
  resolve(name: string): Promise<string | undefined>;
  /** The events of a flow, or undefined when the flow is refused. */
  open(flow: GuestFlow): Promise<AsyncIterable<NetworkEvent> | undefined>;
  send(args: { flow: GuestFlow; bytes: Uint8Array }): void;
  refusals(): readonly NetworkRefusal[];
  close(): Promise<void>;
}

export interface TlsPeer {
  readonly recordedServerNames: readonly string[];
  readonly applicationBytes: number;
}

export interface MqttPeer {
  readonly connects: number;
  readonly published: readonly { readonly topic: string; readonly payload: Uint8Array }[];
}

export interface CertificateAuthority {
  readonly caPem: string;
  issue(hostName: string): { readonly certificatePem: string; readonly keyPem: string };
}

export interface SetupChannel {
  sendWifiSettings(args: { ssid: string; psk: string }): Uint8Array;
}
