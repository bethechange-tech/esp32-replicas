import { describe, expect, it } from "vitest";
import { ParameterCountScanner } from "./support/shape-scanner";
import { Sanctions } from "./support/sanctions";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

const FILE = "packages/boards/src/a.ts";

function scan(args: { source: string; sanctions?: { file: string; name: string; reason: string }[] }) {
  return TempTree.scanning({ files: { [FILE]: args.source }, scan: (tree) => new ParameterCountScanner(tree, args.sanctions ?? []).scan() });
}

describe("two-arguments-at-most", () => {
  it("passes on the tree", () => {
    const report = new ParameterCountScanner(new SourceTree(RepositoryRoot.PATH), Sanctions.TWO_ARGUMENTS).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  describe("breaks-on", () => {
    it("three parameters on a method, a constructor, a function type and an inline callback", () => {
      const report = scan({
        source: [
          "export class A {",
          "  constructor(a: number, b: number, c: number) {}",
          "  run(a: number, b: number, c: number): void {}",
          "}",
          "export type F = (a: number, b: number, c: number) => void;",
          "export interface P { go(a: number, b: number, c: number): void }",
          "export const xs = [1].map((a, b, c) => a + b + c);",
        ].join("\n"),
      });
      expect(report.filesRead).toEqual([FILE]);
      expect(report.offences).toHaveLength(5);
      expect(report.offences.map((o) => o.message.split('"')[1])).toContain("A.constructor");
    });

    it("exactly two parameters, and `this`, are accepted", () => {
      const source = "export class A { run(this: A, a: number, b: number): void {} }";
      expect(scan({ source }).offences).toEqual([]);
    });

    it("a sanction names the function, and a sanction that matches nothing is an offence", () => {
      const source = "export class A { run(a: number, b: number, c: number): void {} }";
      expect(scan({ source, sanctions: [{ file: FILE, name: "A.run", reason: "test" }] }).offences).toEqual([]);
      expect(scan({ source: "export class A {}", sanctions: [{ file: FILE, name: "A.run", reason: "test" }] }).offences).toHaveLength(1);
    });
  });
});
