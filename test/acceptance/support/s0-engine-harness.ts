import type { BoardDeclaration, BoardReplica, ChipFamily, EmulatorEngine } from "@replicas/core";
import { Composition } from "@replicas/cli";
import type { WasmEmulatorEngine } from "@replicas/engine";
import { S0Fixtures } from "./s0-fixtures";

/** Builds a real engine through the composition root and runs it for emulated seconds. */
export class S0EngineHarness {
  private constructor() {}

  static engine(replica: BoardReplica): WasmEmulatorEngine {
    return Composition.engine({
      wasm: S0Fixtures.wasm(),
      romDirectory: S0Fixtures.romDirectory(),
      replica,
      console: "uart0",
      log: { write: () => undefined },
    });
  }

  static async boot(args: { engine: EmulatorEngine; declaration: BoardDeclaration; image: Uint8Array }): Promise<void> {
    await args.engine.create(args.declaration);
    args.engine.load({ bytes: args.image, offset: 0 });
    args.engine.boot();
  }

  /** Run `seconds` of emulated time in slices, and return the console text the firmware wrote. */
  static runConsole(args: { engine: WasmEmulatorEngine; seconds: number }): string {
    const slices = Math.ceil((args.seconds * args.engine.cpuHertz()) / S0Fixtures.SLICE_CYCLES);
    let text = "";
    for (let index = 0; index < slices; index += 1) {
      args.engine.run({ cycles: S0Fixtures.SLICE_CYCLES, unixMilliseconds: S0Fixtures.START_UNIX_MILLISECONDS });
      text += args.engine.takeOutput().console;
    }
    return text;
  }

  static chips(): readonly ChipFamily[] {
    return ["esp32s3", "esp32"];
  }
}
