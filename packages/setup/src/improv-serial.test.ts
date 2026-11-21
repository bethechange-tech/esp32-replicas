import { describe, expect, it } from "vitest";
import { ImprovRefused, ImprovSerial } from "./improv-serial";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/**
 * Vectors worked by hand from improv-wifi/sdk-cpp 8e87b560 (src/improv.cpp, `parse_improv_serial_byte`):
 * "IMPROV" 01, type 03 (RPC), the data length, command 01 (WIFI_SETTINGS) with its own length, the
 * length-prefixed ssid and password, and the byte sum of everything before the last byte.
 */
describe("improv frames match the protocol", () => {
  const channel = new ImprovSerial();

  it("frames WIFI_SETTINGS for a one-letter network", () => {
    expect(hex(channel.sendWifiSettings({ ssid: "a", psk: "b" }))).toBe("494d50524f56010306010401610162b1");
  });

  it("frames the run's fixed Wi-Fi", () => {
    expect(hex(channel.sendWifiSettings({ ssid: "replica-lab", psk: "replica-lab-pass" }))).toBe(
      "494d50524f5601031f011d0b7265706c6963612d6c6162107265706c6963612d6c61622d7061737395",
    );
  });

  it("refuses a name or a password that does not fit a one-byte length, by name", () => {
    expect(() => channel.sendWifiSettings({ ssid: "x".repeat(256), psk: "" })).toThrow(ImprovRefused);
  });

  it("finds a state packet in console text, and drops one with a bad checksum", () => {
    const good = Buffer.from("494d50524f5601010104e4", "hex");
    const bad = Buffer.from("494d50524f5601010104e5", "hex");
    const stream = Buffer.concat([Buffer.from("I (12) log line\r\n"), good, Buffer.from("noise"), bad]);
    expect(ImprovSerial.parse(stream)).toEqual([{ type: "current-state", data: Uint8Array.from([ImprovSerial.STATE_PROVISIONED]) }]);
  });

  it("reads back a packet it framed, as an rpc with the command first", () => {
    const frame = channel.sendWifiSettings({ ssid: "a", psk: "b" });
    const [packet] = ImprovSerial.parse(frame);
    expect(packet?.type).toBe("rpc");
    expect(packet?.data[0]).toBe(ImprovSerial.WIFI_SETTINGS);
  });
});
