import { describe, expect, it } from "vitest";
import { ConfigurationScanner } from "./support/configuration-scanner";
import { Sanctions } from "./support/sanctions";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

const FILE = "packages/cli/src/a.ts";
const READER_FILE = "packages/cli/src/main.ts";

function scan(source: string, file: string = FILE) {
  return TempTree.scanning({
    files: { [file]: source },
    scan: (tree) => new ConfigurationScanner(tree, Sanctions.CONFIGURATION_READER_FILES).scan(),
  });
}

describe("one-configuration-reader", () => {
  it("passes on the tree", () => {
    const report = new ConfigurationScanner(new SourceTree(RepositoryRoot.PATH), Sanctions.CONFIGURATION_READER_FILES).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  describe("breaks-on", () => {
    it("process.env read in a class that is not the reader", () => {
      const report = scan("export class Other { home(): string | undefined { return process.env.HOME; } }");
      expect(report.filesRead).toEqual([FILE]);
      expect(report.offences[0]?.message).toBe("environment read outside ConfigurationReader");
    });

    const reader = "export class ConfigurationReader { home(): string | undefined { return process.env.HOME; } }";

    it("the same read inside ConfigurationReader, in a file the plan names, is accepted", () => {
      const report = scan(reader, READER_FILE);
      expect(report.filesRead).toEqual([READER_FILE]);
      expect(report.offences).toEqual([]);
    });

    it("a class of that name in any other file is refused", () => {
      expect(scan(reader).offences.map((o) => o.message)).toEqual(["environment read outside ConfigurationReader"]);
    });

    it("other spellings: element access, alias, global object, import and import.meta.env", () => {
      const report = scan(
        [
          'import p from "node:process";',
          'export const a = process["env"];',
          "export const b = process;",
          "export const c = globalThis.process;",
          "export const d = import.meta.env;",
        ].join("\n"),
      );
      expect(report.offences.map((o) => o.message)).toEqual([
        "process is imported by name, which hides what reads the environment",
        "environment read by element access outside ConfigurationReader",
        "process is aliased, which hides what reads the environment",
        "process reached through the global object",
        "environment read outside ConfigurationReader",
      ]);
    });

    it("other process members are not the environment", () => {
      expect(scan("export class A { args(): string[] { return process.argv; } }").offences).toEqual([]);
    });
  });
});
