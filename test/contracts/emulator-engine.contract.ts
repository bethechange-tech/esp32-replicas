import { EngineNotCreated, type BoardDeclaration, type EmulatorEngine, type FlashImage, type Slice } from "@replicas/core";
import { describe, expect, it } from "vitest";

export interface EngineSubject {
  readonly engine: EmulatorEngine;
  readonly declaration: BoardDeclaration;
  readonly image: FlashImage;
  /** Text the console shows once the image has booted and run one slice. */
  readonly bannerPart: string;
  readonly slice: Slice;
}

/** What every `EmulatorEngine` does the same way, real or scripted. */
export class EmulatorEngineContract {
  private constructor() {}

  static register(args: { name: string; make: () => EngineSubject }): void {
    describe(`EmulatorEngine contract: ${args.name}`, () => {
      it("refuses every call before create, by name", () => {
        const { engine, image, slice } = args.make();
        expect(() => engine.load(image)).toThrow(EngineNotCreated);
        expect(() => engine.boot()).toThrow(EngineNotCreated);
        expect(() => engine.run(slice)).toThrow(EngineNotCreated);
        expect(() => engine.takeOutput()).toThrow(EngineNotCreated);
      });

      it("shows the console after boot and run, and hands each piece of output over once", async () => {
        const { engine, declaration, image, slice, bannerPart } = args.make();
        await engine.create(declaration);
        engine.load(image);
        engine.boot();
        engine.run(slice);
        const first = engine.takeOutput();
        expect(first.console).toContain(bannerPart);
        expect(engine.takeOutput()).toEqual({ console: "", frames: [], gpioEdges: [] });
      });

      it("is refused again after destroy, and can be created again, on a clean console", async () => {
        const { engine, declaration, image, slice, bannerPart } = args.make();
        await engine.create(declaration);
        engine.destroy();
        expect(() => engine.takeOutput()).toThrow(EngineNotCreated);
        await engine.create(declaration);
        engine.load(image);
        engine.boot();
        engine.run(slice);
        expect(engine.takeOutput().console).toContain(bannerPart);
      });

      it("frees the first engine when created a second time, and the second one runs", async () => {
        const { engine, declaration, image, slice, bannerPart } = args.make();
        await engine.create(declaration);
        await engine.create(declaration);
        engine.load(image);
        engine.boot();
        engine.run(slice);
        expect(engine.takeOutput().console).toContain(bannerPart);
      });

      it("takes console input without refusing it", async () => {
        const { engine, declaration, image } = args.make();
        await engine.create(declaration);
        engine.load(image);
        expect(() => engine.sendInput({ kind: "console", bytes: new Uint8Array([0x00, 0x7f, 0x80, 0xff]) })).not.toThrow();
      });
    });
  }
}
