import type { WifiSpec } from "../run-plan";

/** One Ethernet frame the Wi-Fi station sent or received, as the engine's network monitor reports it. */
export interface NetworkFrame {
  readonly direction: "from-guest" | "to-guest";
  readonly microseconds: number;
  readonly bytes: Uint8Array;
}

/** What the guest's sockets ask of the host: one record of the engine's relay per request. */
export type FlowRequest =
  | { readonly kind: "connect"; readonly id: number; readonly address: string; readonly port: number }
  | { readonly kind: "data"; readonly id: number; readonly bytes: Uint8Array }
  | { readonly kind: "shutdown"; readonly id: number }
  | { readonly kind: "close"; readonly id: number; readonly abort: boolean }
  | { readonly kind: "resolve"; readonly id: number; readonly name: string }
  | { readonly kind: "datagram"; readonly id: number };

/** What the host answers: the events of a flow, or the answer to a name. */
export type FlowAnswer =
  | { readonly kind: "connected"; readonly id: number; readonly credit: number }
  | { readonly kind: "refused"; readonly id: number }
  | { readonly kind: "data"; readonly id: number; readonly bytes: Uint8Array }
  | { readonly kind: "eof"; readonly id: number }
  | { readonly kind: "reset"; readonly id: number }
  | { readonly kind: "credit"; readonly id: number; readonly bytes: number }
  | { readonly kind: "resolved"; readonly id: number; readonly addresses: readonly string[] }
  | { readonly kind: "unresolved"; readonly id: number };

/** The virtual access point and the network behind it. Kept apart from `EmulatorEngine` so a board without Wi-Fi need not offer it. */
export interface GuestRadio {
  /** Puts up the access point and hands the guest's flows and names to the host; call before boot. */
  attachWifi(spec: WifiSpec): void;
  takeFlowRequests(): readonly FlowRequest[];
  /** Returns how many bytes of a data answer the guest took; the rest is to be offered again. */
  answer(answer: FlowAnswer): number;
  takeNetworkFrames(): readonly NetworkFrame[];
}
