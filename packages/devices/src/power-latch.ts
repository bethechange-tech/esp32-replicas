import type { GpioEdge, GpioWatcher } from "@replicas/core";

/** Watches the pin that holds the board's power on: high keeps it up, low lets it go. */
export class PowerLatch implements GpioWatcher {
  private level: boolean | undefined;
  private lastEdgeCycle: number | undefined;

  constructor(private readonly gpio: number) {}

  onEdges(edges: readonly GpioEdge[]): void {
    for (const edge of edges) {
      if (edge.gpio !== this.gpio) continue;
      this.level = edge.level;
      this.lastEdgeCycle = edge.atCycle;
    }
  }

  /** Whether the firmware holds power on; false until it has driven the pin high. */
  holdsPower(): boolean {
    return this.level === true;
  }

  /** The cycle of the pin's latest change, or undefined if it never changed. */
  changedAtCycle(): number | undefined {
    return this.lastEdgeCycle;
  }
}
