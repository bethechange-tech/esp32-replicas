import { describe, expect, it } from "vitest";
import { Confinement, TransportScanner } from "./support/transport-scanner";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

function scan(files: Record<string, string>) {
  return TempTree.scanning({ files, scan: (tree) => new TransportScanner(tree, Confinement.TECHNOLOGIES).scan() });
}

describe("transport-confined", () => {
  it("passes on the tree", () => {
    const report = new TransportScanner(new SourceTree(RepositoryRoot.PATH), Confinement.TECHNOLOGIES).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  describe("breaks-on", () => {
    it("node:net, node:tls and a broker library outside the network adapter", () => {
      const report = scan({
        "packages/boards/src/a.ts": 'import net from "node:net"; import tls from "tls"; import Aedes from "aedes"; export const x = [net, tls, Aedes];',
      });
      expect(report.filesRead).toEqual(["packages/boards/src/a.ts"]);
      expect(report.offences).toHaveLength(3);
    });

    it("the same imports inside their adapter directory are accepted", () => {
      const report = scan({
        "packages/network/src/adapters/node/a.ts": 'import net from "node:net"; import Aedes from "aedes"; export const x = [net, Aedes];',
      });
      expect(report.filesRead).toHaveLength(1);
      expect(report.offences).toEqual([]);
    });

    it("WebAssembly and fetch, by every spelling the guard knows, outside their adapters", () => {
      const report = scan({
        "packages/boards/src/a.ts": [
          "export const a = WebAssembly.instantiate;",
          'export const b = fetch("https://example.org");',
          'export const c = globalThis.fetch("https://example.org");',
          "export const d = fetch;",
          "export type M = WebAssembly.Module;",
        ].join("\n"),
      });
      expect(report.offences).toHaveLength(5);
    });

    it("a method that merely shares the name is not a use", () => {
      const report = scan({ "packages/boards/src/a.ts": "export class A { fetch(): void {} run(a: A): void { a.fetch(); } }" });
      expect(report.offences).toEqual([]);
    });

    it("fetch and WebAssembly inside their own adapters are accepted", () => {
      const report = scan({
        "packages/engine/src/adapters/wasm/a.ts": "export const a = WebAssembly.instantiate;",
        "packages/firmware/src/adapters/download/b.ts": 'export const b = fetch("https://example.org");',
      });
      expect(report.offences).toEqual([]);
    });

    it("child processes are allowed nowhere under packages", () => {
      const report = scan({ "packages/network/src/adapters/node/a.ts": 'import { exec } from "node:child_process"; export const x = exec;' });
      expect(report.offences).toHaveLength(1);
    });
  });
});
