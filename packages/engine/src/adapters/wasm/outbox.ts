import type { NetworkFrame } from "@replicas/core";

export type ConsoleSource = "uart0" | "usb";

interface OutboxMessage {
  readonly t?: string;
  readonly src?: string;
  readonly data?: string;
}

const TEXT_KIND = 1;
const BINARY_KIND = 2;
const NETMON_TYPE = 5;
const NETMON_HEADER_BYTES = 10;
const NETMON_DIRECTION_OFFSET = 1;
const NETMON_TIME_OFFSET = 2;

/** Reads the engine's outbox: the web protocol's JSON messages. Only console text is of interest here. */
export class Outbox {
  private constructor() {}

  static consoleText(args: { messages: readonly { kind: number; payload: Uint8Array }[]; source: ConsoleSource }): string {
    return args.messages
      .filter((message) => message.kind === TEXT_KIND)
      .map((message) => Outbox.parse(message.payload))
      .filter((message) => message?.t === "serial" && message.src === args.source)
      .map((message) => message?.data ?? "")
      .join("");
  }

  /** The frames of the network monitor: `[5][direction: 0 from the station, 1 to it][emulated microseconds, u64 le][frame]`. */
  static networkFrames(messages: readonly { kind: number; payload: Uint8Array }[]): NetworkFrame[] {
    return messages
      .filter((message) => message.kind === BINARY_KIND && message.payload[0] === NETMON_TYPE)
      .map((message) => {
        const view = new DataView(message.payload.buffer, message.payload.byteOffset, message.payload.byteLength);
        return {
          direction: message.payload[NETMON_DIRECTION_OFFSET] === 0 ? ("from-guest" as const) : ("to-guest" as const),
          microseconds: Number(view.getBigUint64(NETMON_TIME_OFFSET, true)),
          bytes: message.payload.slice(NETMON_HEADER_BYTES),
        };
      });
  }

  private static parse(payload: Uint8Array): OutboxMessage | undefined {
    try {
      return JSON.parse(new TextDecoder().decode(payload)) as OutboxMessage;
    } catch {
      return undefined;
    }
  }
}
