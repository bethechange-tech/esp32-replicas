import type { EngineInput } from "@replicas/core";

const LINE_END = "\n";

/** An optional serial line into one UART pin: each text line becomes the bytes the firmware's UART receives. */
export class LineSource {
  constructor(private readonly line: { readonly pin: number; readonly baud: number }) {}

  input(text: string): EngineInput {
    return { kind: "uart", pin: this.line.pin, baud: this.line.baud, bytes: new TextEncoder().encode(`${text}${LINE_END}`) };
  }
}
