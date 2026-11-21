import type { Clock } from "@replicas/core";

export class FixedClock implements Clock {
  constructor(private readonly milliseconds: number) {}

  unixMilliseconds(): number {
    return this.milliseconds;
  }
}
