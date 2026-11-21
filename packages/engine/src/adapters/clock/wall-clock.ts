import type { Clock } from "@replicas/core";

export class WallClock implements Clock {
  unixMilliseconds(): number {
    return Date.now();
  }
}
