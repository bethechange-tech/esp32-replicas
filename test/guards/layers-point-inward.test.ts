import { describe, expect, it } from "vitest";
import { LayerScanner } from "./support/layer-scanner";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

const manifest = TempTree.manifest;

function scan(files: Record<string, string>) {
  return TempTree.scanning({ files, scan: (tree) => new LayerScanner(tree).scan() });
}

describe("layers-point-inward", () => {
  it("passes on the tree, and reads the core files", () => {
    const report = new LayerScanner(new SourceTree(RepositoryRoot.PATH)).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  describe("breaks-on", () => {
    it("accepts a board that imports core and declares it (the control)", () => {
      const report = scan({
        "packages/boards/package.json": manifest({ name: "boards", dependencies: ["@replicas/core"] }),
        "packages/boards/src/a.ts": `import type { X } from "@replicas/core"; export type Y = X;`,
      });
      expect(report.filesRead).toEqual(["packages/boards/src/a.ts"]);
      expect(report.offences).toEqual([]);
    });

    it("core importing a higher layer", () => {
      const report = scan({
        "packages/core/package.json": manifest({ name: "core", dependencies: ["@replicas/devices"] }),
        "packages/core/src/a.ts": `import { D } from "@replicas/devices"; export const x = D;`,
      });
      expect(report.filesRead).toContain("packages/core/src/a.ts");
      expect(report.offences.map((o) => o.message)).toEqual(["core must not import devices (@replicas/devices)"]);
    });

    it("devices importing boards", () => {
      const report = scan({
        "packages/devices/package.json": manifest({ name: "devices", dependencies: ["@replicas/boards"] }),
        "packages/devices/src/a.ts": `import { B } from "@replicas/boards"; export const x = B;`,
      });
      expect(report.offences[0]?.message).toContain("devices must not import boards");
    });

    it("core importing a node module, and any package at all", () => {
      const report = scan({
        "packages/core/package.json": manifest({ name: "core" }),
        "packages/core/src/a.ts": `import fs from "node:fs"; import d from "decimal.js"; export const x = [fs, d];`,
      });
      expect(report.offences.map((o) => o.message)).toEqual([
        "core must not import node:fs",
        "core imports nothing outside itself, not decimal.js",
      ]);
    });

    it("one adapter package importing another", () => {
      const report = scan({
        "packages/engine/package.json": manifest({ name: "engine", dependencies: ["@replicas/network"] }),
        "packages/engine/src/adapters/wasm/a.ts": `import { N } from "@replicas/network"; export const x = N;`,
      });
      expect(report.offences[0]?.message).toBe('adapter "engine" imports adapter "network"');
    });

    it("one adapter directory importing a sibling adapter directory", () => {
      const report = scan({
        "packages/network/package.json": manifest({ name: "network" }),
        "packages/network/src/adapters/node/a.ts": `import { M } from "../memory/b"; export const x = M;`,
        "packages/network/src/adapters/memory/b.ts": `export const M = 1;`,
      });
      expect(report.offences.map((o) => o.message)).toEqual(['adapter "node" imports adapter "memory"']);
    });

    it("a relative import that leaves its package", () => {
      const report = scan({
        "packages/boards/package.json": manifest({ name: "boards" }),
        "packages/boards/src/a.ts": `import { U } from "../../core/src/units"; export const x = U;`,
      });
      expect(report.offences[0]?.message).toContain("relative import leaves its package");
    });

    it("an import that its package does not declare", () => {
      const report = scan({
        "packages/devices/package.json": manifest({ name: "devices" }),
        "packages/devices/src/a.ts": `import d from "decimal.js"; export const x = d;`,
      });
      expect(report.offences[0]?.message).toBe("decimal.js is not declared in packages/devices/package.json");
    });

    it("a dynamic import and a require are read too", () => {
      const report = scan({
        "packages/core/package.json": manifest({ name: "core" }),
        "packages/core/src/a.ts": `export const x = import("node:net"); export const y = require("node:tls");`,
      });
      expect(report.offences).toHaveLength(2);
    });
  });
});
