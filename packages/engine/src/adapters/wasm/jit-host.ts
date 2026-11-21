import type { GuestModule } from "./guest-module";

export interface JitStatistics {
  compiled: number;
  failed: number;
  released: number;
}

const NO_SLOT = 0;

/**
 * Installs the engine's hot guest blocks as extra WebAssembly modules in its function table, as the
 * engine's own browser host does (esp32sim web/wasm/jit.mjs, MIT): execution stays inside WebAssembly and
 * a block that fails to compile is interpreted.
 */
export class JitHost {
  private readonly freeSlots: number[] = [];
  private readonly liveSlots = new Set<number>();
  private readonly counts: JitStatistics = { compiled: 0, failed: 0, released: 0 };

  constructor(private readonly guest: GuestModule) {}

  statistics(): Readonly<JitStatistics> {
    return { ...this.counts };
  }

  compile(args: { pointer: number; length: number }): number {
    try {
      const bytes = this.guest.read(args);
      const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
        env: { memory: this.memory(), table: this.guest.table() },
      });
      const slot = this.freeSlots.pop() ?? this.guest.table().grow(1);
      this.guest.table().set(slot, instance.exports["run"] as (...values: unknown[]) => unknown);
      this.liveSlots.add(slot);
      this.counts.compiled += 1;
      return slot;
    } catch {
      this.counts.failed += 1;
      return NO_SLOT;
    }
  }

  release(slot: number): void {
    if (!this.liveSlots.delete(slot)) return;
    this.guest.table().set(slot, null);
    this.freeSlots.push(slot);
    this.counts.released += 1;
  }

  private memory(): WebAssembly.Memory {
    return this.guest.memory();
  }
}
