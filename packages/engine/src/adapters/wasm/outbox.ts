export type ConsoleSource = "uart0" | "usb";

interface OutboxMessage {
  readonly t?: string;
  readonly src?: string;
  readonly data?: string;
}

const TEXT_KIND = 1;

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

  private static parse(payload: Uint8Array): OutboxMessage | undefined {
    try {
      return JSON.parse(new TextDecoder().decode(payload)) as OutboxMessage;
    } catch {
      return undefined;
    }
  }
}
