import type { GpioEdge, GpioWatcher } from "@replicas/core";
import { describe, expect, it } from "vitest";

export interface GpioWatcherSubject {
  readonly watcher: GpioWatcher;
  /** A pin the watcher does not watch. */
  readonly otherGpio: number;
  /** What the watcher currently reports, compared before and after. */
  readonly observed: () => unknown;
}

/** What every `GpioWatcher` does the same way: edges on pins it does not watch, and no edges at all, change nothing. */
export class GpioWatcherContract {
  private constructor() {}

  static register(args: { name: string; make: () => GpioWatcherSubject }): void {
    describe(`GpioWatcher contract: ${args.name}`, () => {
      it("an empty edge list changes nothing", () => {
        const { watcher, observed } = args.make();
        const before = observed();
        watcher.onEdges([]);
        expect(observed()).toEqual(before);
      });

      it("edges on other pins change nothing, whatever their level", () => {
        const { watcher, observed, otherGpio } = args.make();
        const before = observed();
        const edges: GpioEdge[] = [false, true, false].map((level, atCycle) => ({ gpio: otherGpio, level, atCycle }));
        watcher.onEdges(edges);
        expect(observed()).toEqual(before);
      });
    });
  }
}
