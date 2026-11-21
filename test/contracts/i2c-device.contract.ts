import type { I2cDevice } from "@replicas/core";
import { describe, expect, it } from "vitest";

/** The register a subject can be pointed at, and the bytes it answers there. */
export interface I2cDeviceSubject {
  readonly device: I2cDevice;
  readonly register: number;
  readonly length: number;
}

/** What every `I2cDevice` does the same way: a write names a register and the device acknowledges it, a read from it is repeatable, and a stop ends the transaction. */
export class I2cDeviceContract {
  private constructor() {}

  static register(args: { name: string; make: () => I2cDeviceSubject }): void {
    describe(`I2cDevice contract: ${args.name}`, () => {
      const pointAt = (subject: I2cDeviceSubject): void => {
        subject.device.start({ read: false });
        expect(subject.device.write(subject.register)).toBe(true);
        subject.device.start({ read: true });
      };
      const readBytes = (subject: I2cDeviceSubject): number[] => {
        pointAt(subject);
        const bytes = Array.from({ length: subject.length }, () => subject.device.read());
        subject.device.stop();
        return bytes;
      };

      it("reads bytes, each one a byte", () => {
        for (const byte of readBytes(args.make())) {
          expect(Number.isInteger(byte)).toBe(true);
          expect(byte).toBeGreaterThanOrEqual(0);
          expect(byte).toBeLessThanOrEqual(0xff);
        }
      });

      it("answers the same read the same way when nothing changed in between", () => {
        const subject = args.make();
        expect(readBytes(subject)).toEqual(readBytes(subject));
      });

      it("a stop ends the transaction: the next write names a register again", () => {
        const subject = args.make();
        const first = readBytes(subject);
        subject.device.start({ read: false });
        subject.device.write(subject.register);
        subject.device.stop();
        expect(readBytes(subject)).toEqual(first);
      });
    });
  }
}
