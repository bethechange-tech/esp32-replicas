import type { Sanction } from "./guard-report";

/** One pinned list per rule. Each entry names its file and the exact thing, and says why. */
export class Sanctions {
  static readonly CLASSES_ONLY: readonly Sanction[] = [];
  static readonly TWO_ARGUMENTS: readonly Sanction[] = [];
  static readonly PRODUCT_NAMES: readonly Sanction[] = [];
  /** An exception class is built at the place it is thrown. Each is pinned by its file and name; an entry that matches nothing is an offence. */
  static readonly ONLY_ROOTS_CONSTRUCT: readonly Sanction[] = [
    { file: "packages/engine/src/adapters/wasm/guest-module.ts", name: "GuestExportMissing", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/engine/src/adapters/wasm/guest-module.ts", name: "GuestModuleNotBound", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/engine/src/adapters/wasm/wasm-emulator-engine.ts", name: "EngineRefused", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/engine/src/adapters/wasm/wasm-emulator-engine.ts", name: "EngineStopped", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/engine/src/adapters/wasm/wasm-emulator-engine.ts", name: "EngineNotCreated", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/firmware/src/adapters/files/directory-rom-source.ts", name: "RomRefused", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/firmware/src/flash-image-validator.ts", name: "FlashImageRefused", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/core/src/board-facts.ts", name: "UnknownFact", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/core/src/board-facts-parser.ts", name: "FactsRefused", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/cli/src/run-arguments.ts", name: "ArgumentsRefused", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/firmware/src/partition-table.ts", name: "PartitionNotFound", reason: "an exception is a value built where it is thrown, not a collaborator" },
    { file: "packages/setup/src/improv-serial.ts", name: "ImprovRefused", reason: "an exception is a value built where it is thrown, not a collaborator" },
  ];

  /** Composition roots are the only files that may build a concrete class (S0b and later add the files). */
  static readonly COMPOSITION_ROOTS: readonly string[] = [
    "packages/cli/src/composition.ts",
    "packages/web/src/worker-composition.ts",
  ];

  /** Where the one `ConfigurationReader` may live: each entry, and the CLI's own file. */
  static readonly CONFIGURATION_READER_FILES: readonly string[] = [
    "packages/cli/src/main.ts",
    "packages/cli/src/configuration-reader.ts",
    "packages/web/src/worker-composition.ts",
  ];

  private constructor() {}
}
