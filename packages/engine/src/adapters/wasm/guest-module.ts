const WASM_PAGE_BYTES = 65_536;

export class GuestModuleNotBound extends Error {
  constructor() {
    super("the engine module is not instantiated yet");
  }
}

export class GuestExportMissing extends Error {
  constructor(name: string) {
    super(`the engine module exports no function ${name}`);
  }
}

/** The instantiated module: its memory and function table, and calls by export name. */
export class GuestModule {
  private exportsOfModule: WebAssembly.Exports | undefined;

  bind(exportsOfModule: WebAssembly.Exports): void {
    this.exportsOfModule = exportsOfModule;
  }

  call(args: { name: string; values: readonly number[] }): number {
    const candidate = this.bound()[args.name];
    if (typeof candidate !== "function") throw new GuestExportMissing(args.name);
    return Number((candidate as (...values: number[]) => number | bigint | undefined)(...args.values) ?? 0);
  }

  /** A fresh view: the memory may have grown since the last one. */
  view(): Uint8Array {
    return new Uint8Array((this.bound()["memory"] as WebAssembly.Memory).buffer);
  }

  memory(): WebAssembly.Memory {
    return this.bound()["memory"] as WebAssembly.Memory;
  }

  table(): WebAssembly.Table {
    return this.bound()["__indirect_function_table"] as WebAssembly.Table;
  }

  pages(): number {
    return this.view().length / WASM_PAGE_BYTES;
  }

  read(args: { pointer: number; length: number }): Uint8Array {
    return this.view().slice(args.pointer, args.pointer + args.length);
  }

  write(args: { pointer: number; bytes: Uint8Array }): void {
    this.view().set(args.bytes, args.pointer);
  }

  text(args: { pointer: number; length: number }): string {
    return new TextDecoder().decode(this.read(args));
  }

  /** Copy bytes into the module's own allocator and return where they went. */
  allocate(bytes: Uint8Array): number {
    const pointer = this.call({ name: "esp32sim_alloc", values: [bytes.length] });
    this.write({ pointer, bytes });
    return pointer;
  }

  release(args: { pointer: number; length: number }): void {
    this.call({ name: "esp32sim_free", values: [args.pointer, args.length] });
  }

  private bound(): WebAssembly.Exports {
    if (!this.exportsOfModule) throw new GuestModuleNotBound();
    return this.exportsOfModule;
  }
}
