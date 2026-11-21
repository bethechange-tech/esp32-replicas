import type { NetworkFrame } from "@replicas/core";

const ETHERNET_HEADER_BYTES = 14;
const IPV4_PROTOCOL_OFFSET = 9;
const IPV4_HEADER_LENGTH_MASK = 0x0f;
const WORDS_TO_BYTES = 4;
const UDP_HEADER_BYTES = 8;
const UDP_PROTOCOL = 17;
const DHCP_CLIENT_PORT = 68;
const DHCP_YIADDR_OFFSET = 16;
const DHCP_OPTIONS_OFFSET = 240;
const OPTION_MESSAGE_TYPE = 53;
const OPTION_END = 255;
const OPTION_PAD = 0;
const MESSAGE_ACK = 5;
const DST_PORT_OFFSET = 2;

/** Reads the DHCP replies in the frames the station received (RFC 2131, RFC 2132 option 53). */
export class DhcpFrames {
  private constructor() {}

  /** Addresses the guest was acknowledged, in order. */
  static acknowledgedAddresses(frames: readonly NetworkFrame[]): string[] {
    return frames
      .filter((frame) => frame.direction === "to-guest")
      .map((frame) => DhcpFrames.acknowledgement(frame.bytes))
      .filter((address): address is string => address !== undefined);
  }

  private static acknowledgement(frame: Uint8Array): string | undefined {
    const ip = frame.subarray(ETHERNET_HEADER_BYTES);
    if (ip[IPV4_PROTOCOL_OFFSET] !== UDP_PROTOCOL) return undefined;
    const udp = ip.subarray(((ip[0] ?? 0) & IPV4_HEADER_LENGTH_MASK) * WORDS_TO_BYTES);
    const destination = ((udp[DST_PORT_OFFSET] ?? 0) << 8) | (udp[DST_PORT_OFFSET + 1] ?? 0);
    if (destination !== DHCP_CLIENT_PORT) return undefined;
    const dhcp = udp.subarray(UDP_HEADER_BYTES);
    if (dhcp.length < DHCP_OPTIONS_OFFSET || DhcpFrames.messageType(dhcp) !== MESSAGE_ACK) return undefined;
    return Array.from(dhcp.subarray(DHCP_YIADDR_OFFSET, DHCP_YIADDR_OFFSET + WORDS_TO_BYTES)).join(".");
  }

  private static messageType(dhcp: Uint8Array): number | undefined {
    for (let at = DHCP_OPTIONS_OFFSET; at < dhcp.length; ) {
      const option = dhcp[at];
      if (option === OPTION_END || option === undefined) return undefined;
      if (option === OPTION_PAD) {
        at += 1;
        continue;
      }
      if (option === OPTION_MESSAGE_TYPE) return dhcp[at + 2];
      at += 2 + (dhcp[at + 1] ?? 0);
    }
    return undefined;
  }
}
