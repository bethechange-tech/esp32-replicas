import type { Output } from "@replicas/core";

export class RecordingOutput implements Output {
  private text = "";

  write(text: string): void {
    this.text += text;
  }

  written(): string {
    return this.text;
  }
}
