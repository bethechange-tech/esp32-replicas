import { describe, expect, it } from "vitest";
import { ProductNameScanner, ProductNames } from "./support/product-name-scanner";
import { Sanctions } from "./support/sanctions";
import { RepositoryRoot, TempTree } from "./support/temp-tree";
import { SourceTree } from "./support/source-tree";

function scan(args: { files: Record<string, string>; sanctions?: { file: string; name: string; reason: string }[] }) {
  return TempTree.scanning({ files: args.files, scan: (tree) => new ProductNameScanner(tree, args.sanctions ?? []).scan() });
}

describe("no-product-names", () => {
  it("passes on the tree", () => {
    const report = new ProductNameScanner(new SourceTree(RepositoryRoot.PATH), Sanctions.PRODUCT_NAMES).scan();
    expect(report.filesRead).toContain("packages/core/src/units.ts");
    expect(report.offences).toEqual([]);
  });

  it("lists the products the plan names", () => {
    for (const name of ["waveshare", "elecrow", "crowpanel", "esp32sim", "espressif", "esphome", "mosquitto", "aedes", "rustls"]) {
      expect(ProductNames.LISTED).toContain(name);
    }
  });

  it("allows protocols, standards and chip families", () => {
    for (const name of ["MqttPeer", "HttpClient", "I2cDevice", "SpiTransaction", "Esp32s3Chip", "Cst816", "Ina226"]) {
      expect(ProductNames.within(name)).toBeUndefined();
    }
  });

  describe("breaks-on", () => {
    it("an exported class, interface, type, const and re-export carrying a product name", () => {
      const report = scan({
        files: {
          "packages/boards/src/a.ts": [
            "export class WaveshareBoard {}",
            "export interface ElecrowPanel {}",
            "export type CrowPanelId = string;",
            "export const ESPHOME_VERSION = 1;",
            "class Hidden {} export { Hidden as AedesBroker };",
          ].join("\n"),
        },
      });
      expect(report.filesRead).toEqual(["packages/boards/src/a.ts"]);
      expect(report.offences.map((o) => o.message.split('"')[1])).toEqual([
        "WaveshareBoard",
        "ElecrowPanel",
        "CrowPanelId",
        "ESPHOME_VERSION",
        "AedesBroker",
      ]);
    });

    it("an adapter directory named for a product, unless its exact path is sanctioned", () => {
      const files = { "packages/network/src/adapters/aedes/a.ts": "export class InProcessBroker {}" };
      expect(scan({ files }).offences.map((o) => o.file)).toEqual(["packages/network/src/adapters/aedes"]);
      const sanctioned = scan({
        files,
        sanctions: [{ file: "packages/network/src/adapters/aedes", name: "aedes", reason: "test" }],
      });
      expect(sanctioned.offences).toEqual([]);
    });

    it("a sanction that matches nothing is an offence", () => {
      const report = scan({
        files: { "packages/boards/src/a.ts": "export class A {}" },
        sanctions: [{ file: "packages/boards/src/gone", name: "gone", reason: "none" }],
      });
      expect(report.offences).toHaveLength(1);
    });
  });
});
