import { describe, expect, it } from "vitest";
import { FactsFileScanner, NumericLiteralScanner } from "./support/facts-scanner";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

function scanFacts(json: string) {
  return TempTree.scanning({ files: { "facts/boards.json": json }, scan: (tree) => new FactsFileScanner(tree).scan() });
}

function scanNumbers(args: { source: string; file?: string }) {
  return TempTree.scanning({
    files: { [args.file ?? "packages/boards/src/a.ts"]: args.source },
    scan: (tree) => new NumericLiteralScanner(tree).scan(),
  });
}

describe("facts-have-public-sources", () => {
  it("passes on the tree; the facts file is read when it exists (S1 adds the first board)", () => {
    const tree = new SourceTree(RepositoryRoot.PATH);
    const report = new FactsFileScanner(tree).scan();
    expect(report.filesRead).toEqual(tree.exists("facts/boards.json") ? ["facts/boards.json"] : []);
    expect(report.offences).toEqual([]);
    expect(new NumericLiteralScanner(tree).scan().offences).toEqual([]);
  });

  describe("breaks-on", () => {
    const fact = (extra: string): string => `{"small-screen":{"flash":{"value":16,"unit":"byte"${extra}}}}`;

    it("a fact with a public source passes (the control)", () => {
      const report = scanFacts(fact(',"source":"https://example.org/datasheet"'));
      expect(report.filesRead).toEqual(["facts/boards.json"]);
      expect(report.offences).toEqual([]);
    });

    it("a fact with no source, or an http source", () => {
      expect(scanFacts(fact("")).offences[0]?.message).toContain("a fact needs a public https source");
      expect(scanFacts(fact(',"source":"http://example.org/x"')).offences).toHaveLength(1);
    });

    it("a number with no unit", () => {
      const report = scanFacts('{"a":{"value":5,"source":"https://example.org/x"}}');
      expect(report.offences.map((o) => o.message)).toEqual(["$.a: a number needs its unit"]);
    });

    it("a board file holds no number but 0 and 1, named constant or not", () => {
      expect(scanNumbers({ source: "export class B { pin(): number { return 15; } }" }).offences[0]?.message).toContain("number 15");
      expect(scanNumbers({ source: "export class B { static readonly SDA_PIN = 11; }" }).offences).toHaveLength(1);
      expect(scanNumbers({ source: "const SCL = 10; export class B { scl = SCL; }" }).offences).toHaveLength(1);
      expect(scanNumbers({ source: "export class B { first(): number { return 0; } next(): number { return 1; } }" }).offences).toEqual([]);
    });

    it("a device file may keep named register constants, but not a bare number", () => {
      const file = "packages/devices/src/a.ts";
      expect(scanNumbers({ file, source: "export class D { static readonly CHIP_ID_REGISTER = 0xa7; }" }).offences).toEqual([]);
      expect(scanNumbers({ file, source: "const STATUS = 0x02; export class D { s = STATUS; }" }).offences).toEqual([]);
      expect(scanNumbers({ file, source: "export class D { read(): number { return 0xa7; } }" }).offences).toHaveLength(1);
    });

    it("the number scan reads board and device files only", () => {
      const report = TempTree.scanning({
        files: { "packages/core/src/a.ts": "export const x = (): number => 15;" },
        scan: (tree) => new NumericLiteralScanner(tree).scan(),
      });
      expect(report.filesRead).toEqual([]);
    });
  });
});
