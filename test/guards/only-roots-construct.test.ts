import { describe, expect, it } from "vitest";
import { RootConstructionScanner } from "./support/root-construction-scanner";
import { Sanctions } from "./support/sanctions";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

const ROOT_FILE = "packages/cli/src/composition.ts";
const SERVICE = "packages/boards/src/service.ts";

function scan(args: { files: Record<string, string>; sanctions?: { file: string; name: string; reason: string }[] }) {
  return TempTree.scanning({
    files: args.files,
    scan: (tree) => new RootConstructionScanner(tree, { roots: [ROOT_FILE], sanctions: args.sanctions ?? [] }).scan(),
  });
}

describe("only-roots-construct", () => {
  it("passes on the tree", () => {
    const report = new RootConstructionScanner(new SourceTree(RepositoryRoot.PATH), {
      roots: Sanctions.COMPOSITION_ROOTS,
      sanctions: Sanctions.ONLY_ROOTS_CONSTRUCT,
    }).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  describe("breaks-on", () => {
    const service = `export class Service { run(): void {} }`;

    it("a class built outside a root", () => {
      const report = scan({
        files: { [SERVICE]: service, "packages/boards/src/user.ts": `import { Service } from "./service"; export class User { s = new Service(); }` },
      });
      expect(report.filesRead).toContain("packages/boards/src/user.ts");
      expect(report.offences.map((o) => o.message)).toEqual(["new Service outside a composition root"]);
    });

    it("a class exported by a list, with or without a new name, or by default, counts as exported", () => {
      for (const list of ["export { Service };", "export { Service as Renamed };", "export default Service;"]) {
        const report = scan({
          files: {
            [SERVICE]: `class Service { run(): void {} } ${list}`,
            "packages/boards/src/user.ts": `import { Service } from "./service"; export const s = new Service();`,
          },
        });
        expect(report.offences.map((o) => o.message)).toEqual(["new Service outside a composition root"]);
      }
    });

    it("an abstract class, and a class that is not exported, are not concrete exports", () => {
      const report = scan({
        files: {
          [SERVICE]: `abstract class Base {} class Hidden {} export { Base };`,
          "packages/boards/src/user.ts": `export const s = new Hidden();`,
        },
      });
      expect(report.offences).toEqual([]);
    });

    it("a class imported under another name is still the same class", () => {
      const report = scan({
        files: { [SERVICE]: service, "packages/boards/src/user.ts": `import { Service as Renamed } from "./service"; export const s = new Renamed();` },
      });
      expect(report.offences.map((o) => o.message)).toEqual(["new Service outside a composition root"]);
    });

    it("the same line in a composition root is accepted", () => {
      const report = scan({ files: { [SERVICE]: service, [ROOT_FILE]: `import { Service } from "@replicas/boards"; export const s = new Service();` } });
      expect(report.filesRead).toContain(ROOT_FILE);
      expect(report.offences).toEqual([]);
    });

    it("a class may build itself (a named constructor)", () => {
      const report = scan({ files: { [SERVICE]: `export class Service { static make(): Service { return new Service(); } }` } });
      expect(report.offences).toEqual([]);
    });

    it("a sanction that matches nothing is an offence", () => {
      const report = scan({ files: { [SERVICE]: service }, sanctions: [{ file: SERVICE, name: "Ghost", reason: "none" }] });
      expect(report.offences.map((o) => o.message)).toEqual(['sanction for "Ghost" matches nothing']);
    });

    it("a sanction that matches is spent, and then is not stale", () => {
      const report = scan({
        files: { [SERVICE]: service, "packages/boards/src/user.ts": `import { Service } from "./service"; export const s = new Service();` },
        sanctions: [{ file: "packages/boards/src/user.ts", name: "Service", reason: "test" }],
      });
      expect(report.offences).toEqual([]);
    });
  });
});
