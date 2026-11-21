import type { Output } from "@replicas/core";

export class StandardOutput implements Output {
  write(text: string): void {
    process.stdout.write(text);
  }
}
