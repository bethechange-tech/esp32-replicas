import type { Output } from "@replicas/core";
import { describe, expect, it } from "vitest";

export interface OutputSubject {
  readonly output: Output;
  /** Everything written so far, as the subject kept or sent it. */
  readonly written: () => string;
}

/** What every `Output` does the same way: text written comes out whole, in order. */
export class OutputContract {
  private constructor() {}

  static register(args: { name: string; make: () => OutputSubject }): void {
    describe(`Output contract: ${args.name}`, () => {
      it("keeps what is written, in order, without adding anything", () => {
        const { output, written } = args.make();
        output.write("one\n");
        output.write("two");
        expect(written()).toBe("one\ntwo");
      });
    });
  }
}
