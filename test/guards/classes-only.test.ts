import { describe, expect, it } from "vitest";
import { ClassesOnlyScanner } from "./support/shape-scanner";
import { Sanctions } from "./support/sanctions";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

const FILE = "packages/boards/src/a.ts";

function scan(args: { source: string; sanctions?: { file: string; name: string; reason: string }[] }) {
  return TempTree.scanning({ files: { [FILE]: args.source }, scan: (tree) => new ClassesOnlyScanner(tree, args.sanctions ?? []).scan() });
}

describe("classes-only", () => {
  it("passes on the tree", () => {
    const report = new ClassesOnlyScanner(new SourceTree(RepositoryRoot.PATH), Sanctions.CLASSES_ONLY).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  describe("breaks-on", () => {
    it("a top-level function declaration", () => {
      const report = scan({ source: "export function helper(): number { return 1; }" });
      expect(report.filesRead).toEqual([FILE]);
      expect(report.offences[0]?.message).toContain('top-level function "helper"');
    });

    it("a module-level const that is an arrow, a function expression, or wrapped in a cast", () => {
      const report = scan({
        source: ["export const a = (): number => 1;", "const b = function () { return 1; };", "const c = ((): number => 1) as () => number;"].join("\n"),
      });
      expect(report.offences).toHaveLength(3);
    });

    it("module-level let or var, and a const object of functions", () => {
      const report = scan({
        source: ["export let counter = 0;", "var cache = {};", "export const tools = { run() { return 1; }, go: () => 2 };", "export const data = { a: 1 };"].join("\n"),
      });
      expect(report.offences.map((o) => o.message)).toEqual([
        'module-level let or var "counter" is mutable state',
        'module-level let or var "cache" is mutable state',
        'module-level const "tools" is an object of functions: make it a class',
      ]);
    });

    it("a default-exported function", () => {
      expect(scan({ source: "export default () => 1;" }).offences[0]?.message).toContain("default-exported function");
    });

    it("a class of only static members without a private constructor", () => {
      const report = scan({ source: "export class Helpers { static one(): number { return 1; } }" });
      expect(report.offences[0]?.message).toContain("give it a private constructor");
    });

    it("a static-only class with a private constructor, and a callback inside a method, are accepted", () => {
      const source = "export class Helpers { private constructor() {} static all(xs: number[]): number[] { return xs.map((x) => x); } }";
      expect(scan({ source }).offences).toEqual([]);
    });

    it("a sanction names the thing, and a sanction that matches nothing is an offence", () => {
      const source = "export function helper(): number { return 1; }";
      expect(scan({ source, sanctions: [{ file: FILE, name: "helper", reason: "test" }] }).offences).toEqual([]);
      expect(scan({ source: "export class A {}", sanctions: [{ file: FILE, name: "helper", reason: "test" }] }).offences).toHaveLength(1);
    });
  });
});
