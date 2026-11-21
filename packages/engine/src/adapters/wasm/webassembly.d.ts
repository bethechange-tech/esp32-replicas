/** The part of the WebAssembly JavaScript API the engine adapter uses; Node and every browser provide it. */
declare namespace WebAssembly {
  type ExportValue = ((...values: never[]) => unknown) | Global | Memory | Table;
  type Exports = Record<string, ExportValue>;
  type ImportValue = ((...values: never[]) => unknown) | Global | Memory | Table | number;
  type Imports = Record<string, Record<string, ImportValue>>;
  interface Global {
    value: unknown;
  }
  class Memory {
    constructor(descriptor: { initial: number; maximum?: number });
    readonly buffer: ArrayBuffer;
  }
  class Table {
    readonly length: number;
    grow(delta: number): number;
    set(index: number, value: unknown): void;
  }
  class Module {
    constructor(bytes: BufferSource);
  }
  class Instance {
    constructor(module: Module, imports?: Imports);
    readonly exports: Exports;
  }
  interface WebAssemblyInstantiatedSource {
    module: Module;
    instance: Instance;
  }
  function instantiate(bytes: BufferSource, imports?: Imports): Promise<WebAssemblyInstantiatedSource>;
}
