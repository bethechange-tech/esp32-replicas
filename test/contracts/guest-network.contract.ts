import type { GuestNetwork } from "@replicas/core";
import { describe, expect, it } from "vitest";

const UNMAPPED_NAME = "unmapped.test";
const UNKNOWN_ADDRESS = "198.51.100.7";

/** What every `GuestNetwork` does the same way: it refuses what it does not carry, and says which. */
export class GuestNetworkContract {
  private constructor() {}

  static register(args: { name: string; make: () => GuestNetwork }): void {
    describe(`GuestNetwork contract: ${args.name}`, () => {
      it("refuses a name it has no answer for, and records the refusal by that name", async () => {
        const network = args.make();
        expect(await network.resolve(UNMAPPED_NAME)).toBeUndefined();
        expect(network.refusals().map((refusal) => refusal.subject)).toContain(UNMAPPED_NAME);
        await network.close();
      });

      it("refuses a flow to an address it does not carry, by that flow", async () => {
        const network = args.make();
        const flow = { protocol: "tcp", address: UNKNOWN_ADDRESS, port: 8883 } as const;
        expect(await network.open(flow)).toBeUndefined();
        expect(network.refusals().map((refusal) => refusal.subject)).toContain(`tcp:${UNKNOWN_ADDRESS}:8883`);
        await network.close();
      });

      it("refuses bytes sent on a flow that was never opened", async () => {
        const network = args.make();
        network.send({ flow: { protocol: "tcp", address: UNKNOWN_ADDRESS, port: 8883 }, bytes: new Uint8Array([1]) });
        expect(network.refusals()).toHaveLength(1);
        await network.close();
      });

      it("hands out a copy of its refusals, and can be closed twice", async () => {
        const network = args.make();
        await network.resolve(UNMAPPED_NAME);
        const copy = [...network.refusals()];
        copy.pop();
        expect(network.refusals()).toHaveLength(1);
        await network.close();
        await expect(network.close()).resolves.toBeUndefined();
      });
    });
  }
}
