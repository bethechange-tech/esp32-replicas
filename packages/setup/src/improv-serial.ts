import type { SetupChannel } from "@replicas/core";

export type ImprovPacketType = "current-state" | "error-state" | "rpc" | "rpc-result";

export interface ImprovPacket {
  readonly type: ImprovPacketType;
  readonly data: Uint8Array;
}

export class ImprovRefused extends Error {
  constructor(reason: string) {
    super(`improv: ${reason}`);
  }
}

/**
 * Improv Wi-Fi over serial, the standard wired Wi-Fi setup the ESPHome `improv_serial` component speaks. Layout
 * and constants from improv-wifi/sdk-cpp at 8e87b560 (src/improv.h, src/improv.cpp: `parse_improv_serial_byte`):
 * "IMPROV", version 1, a type, a length, the data, and a checksum that is the byte sum of everything before it.
 * An RPC's data is the command, the length of what follows, then length-prefixed strings.
 */
export class ImprovSerial implements SetupChannel {
  static readonly HEADER = "IMPROV";
  static readonly VERSION = 1;
  static readonly WIFI_SETTINGS = 0x01;
  static readonly STATE_PROVISIONED = 0x04;
  private static readonly TYPES: Readonly<Record<number, ImprovPacketType>> = {
    0x01: "current-state",
    0x02: "error-state",
    0x03: "rpc",
    0x04: "rpc-result",
  };
  private static readonly TYPE_RPC = 0x03;
  private static readonly TYPE_OFFSET = 7;
  private static readonly LENGTH_OFFSET = 8;
  private static readonly DATA_OFFSET = 9;
  private static readonly BYTE_MASK = 0xff;
  private static readonly MAX_STRING_BYTES = 255;

  sendWifiSettings(args: { ssid: string; psk: string }): Uint8Array {
    const ssid = Buffer.from(args.ssid, "utf8");
    const psk = Buffer.from(args.psk, "utf8");
    if (ssid.length > ImprovSerial.MAX_STRING_BYTES || psk.length > ImprovSerial.MAX_STRING_BYTES) {
      throw new ImprovRefused("a name or password is longer than 255 bytes");
    }
    const settings = Buffer.concat([Buffer.from([ssid.length]), ssid, Buffer.from([psk.length]), psk]);
    const command = Buffer.concat([Buffer.from([ImprovSerial.WIFI_SETTINGS, settings.length]), settings]);
    return ImprovSerial.frame({ type: ImprovSerial.TYPE_RPC, data: command });
  }

  /** The packets in a stream of console bytes; text around them is skipped, a damaged packet is dropped. */
  static parse(stream: Uint8Array): ImprovPacket[] {
    const bytes = Buffer.from(stream);
    const packets: ImprovPacket[] = [];
    let from = bytes.indexOf(ImprovSerial.HEADER);
    while (from >= 0) {
      const packet = ImprovSerial.read({ bytes, start: from });
      if (packet) packets.push(packet);
      from = bytes.indexOf(ImprovSerial.HEADER, from + ImprovSerial.HEADER.length);
    }
    return packets;
  }

  private static read(args: { bytes: Buffer; start: number }): ImprovPacket | undefined {
    const { bytes, start } = args;
    if (bytes[start + ImprovSerial.HEADER.length] !== ImprovSerial.VERSION) return undefined;
    const type = ImprovSerial.TYPES[bytes[start + ImprovSerial.TYPE_OFFSET] ?? -1];
    const length = bytes[start + ImprovSerial.LENGTH_OFFSET];
    if (!type || length === undefined) return undefined;
    const end = start + ImprovSerial.DATA_OFFSET + length;
    const checksum = bytes[end];
    if (checksum === undefined || ImprovSerial.checksum(bytes.subarray(start, end)) !== checksum) return undefined;
    return { type, data: Uint8Array.from(bytes.subarray(start + ImprovSerial.DATA_OFFSET, end)) };
  }

  private static frame(args: { type: number; data: Uint8Array }): Uint8Array {
    const body = Buffer.concat([
      Buffer.from(ImprovSerial.HEADER, "ascii"),
      Buffer.from([ImprovSerial.VERSION, args.type, args.data.length]),
      args.data,
    ]);
    return Buffer.concat([body, Buffer.from([ImprovSerial.checksum(body)])]);
  }

  private static checksum(bytes: Uint8Array): number {
    return bytes.reduce((sum, byte) => sum + byte, 0) & ImprovSerial.BYTE_MASK;
  }
}
