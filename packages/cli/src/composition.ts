import type { BoardReplica } from "@replicas/core";
import {
  EngineAbi,
  GuestModule,
  HostBoardBridge,
  HostImports,
  JitHost,
  WasmEmulatorEngine,
  type ConsoleSource,
  type EngineLog,
} from "@replicas/engine";
import { DirectoryRomSource } from "@replicas/firmware";

export interface EngineOptions {
  /** The compiled engine module's bytes (`build/esp32sim.wasm`). */
  readonly wasm: Uint8Array;
  readonly romDirectory: string;
  readonly replica: BoardReplica;
  readonly console: ConsoleSource;
  readonly log: EngineLog;
}

/** The composition root: the one place the concrete classes are chosen and joined. */
export class Composition {
  private constructor() {}

  static engine(options: EngineOptions): WasmEmulatorEngine {
    const guest = new GuestModule();
    const bridge = new HostBoardBridge(options.replica, guest);
    const jit = new JitHost(guest);
    return new WasmEmulatorEngine({
      wasm: options.wasm,
      roms: new DirectoryRomSource(options.romDirectory),
      guest,
      abi: new EngineAbi(guest),
      bridge,
      imports: new HostImports({ guest, bridge, jit, log: options.log }),
      console: options.console,
    });
  }
}
