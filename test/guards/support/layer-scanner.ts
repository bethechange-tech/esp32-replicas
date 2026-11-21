import path from "node:path";
import type ts from "typescript";
import { ReportBuilder, type GuardReport } from "./guard-report";
import { SourceTree, type ParsedFile } from "./source-tree";
import { Syntax } from "./syntax";

type Layer = "core" | "devices" | "boards" | "adapter" | "root";

const LAYER_OF_PACKAGE: Readonly<Record<string, Layer>> = {
  core: "core",
  devices: "devices",
  boards: "boards",
  engine: "adapter",
  network: "adapter",
  setup: "adapter",
  firmware: "adapter",
  cli: "root",
  web: "root",
};

const MAY_IMPORT: Readonly<Record<Layer, readonly Layer[]>> = {
  core: [],
  devices: ["core"],
  boards: ["core", "devices"],
  adapter: ["core", "devices"],
  root: ["core", "devices", "boards", "adapter"],
};

const PURE_LAYERS: readonly Layer[] = ["core", "devices", "boards"];
const SCOPE = "@replicas/";
const ADAPTER_DIRECTORY = /(^|\/)adapters\/([^/]+)\//;

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

/** Layers point inward; adapters never import each other; every import is declared in its package (rule 15a). */
export class LayerScanner {
  constructor(private readonly tree: SourceTree) {}

  scan(): GuardReport {
    const report = new ReportBuilder();
    for (const file of this.tree.files()) {
      report.read(file.path);
      this.scanFile({ file, report });
    }
    return report.build();
  }

  private scanFile(args: { file: ParsedFile; report: ReportBuilder }): void {
    const { file, report } = args;
    const owner = SourceTree.packageOf(file.path);
    const layer = owner ? LAYER_OF_PACKAGE[owner] : undefined;
    const offend = (node: ts.Node, message: string): void =>
      report.offend({ file: file.path, line: Syntax.line({ sourceFile: file.sourceFile, node }), rule: "layers", message });
    if (!owner || !layer) {
      report.offend({ file: file.path, line: 0, rule: "layers", message: "package is not in the layer map" });
      return;
    }
    const manifest = this.manifestOf(owner);
    for (const reference of Syntax.moduleReferences(file.sourceFile)) {
      const message = this.problemWith({ owner, layer, manifest, file: file.path, specifier: reference.specifier });
      if (message) offend(reference.node, message);
    }
  }

  private problemWith(args: {
    owner: string;
    layer: Layer;
    manifest: PackageManifest | undefined;
    file: string;
    specifier: string;
  }): string | undefined {
    const { owner, layer, manifest, file, specifier } = args;
    if (specifier.startsWith(".")) return this.relativeProblem({ file, specifier });
    if (specifier.startsWith("node:")) {
      return PURE_LAYERS.includes(layer) ? `${layer} must not import ${specifier}` : undefined;
    }
    if (specifier.startsWith(SCOPE)) return this.workspaceProblem({ owner, layer, manifest, specifier });
    if (layer === "core") return `core imports nothing outside itself, not ${specifier}`;
    return this.isDeclared({ manifest, name: LayerScanner.packageName(specifier) })
      ? undefined
      : `${specifier} is not declared in packages/${owner}/package.json`;
  }

  private relativeProblem(args: { file: string; specifier: string }): string | undefined {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(args.file), args.specifier));
    if (SourceTree.packageOf(`${target}/`) !== SourceTree.packageOf(args.file)) {
      return `relative import leaves its package: ${args.specifier}`;
    }
    const from = ADAPTER_DIRECTORY.exec(args.file)?.[2];
    const into = ADAPTER_DIRECTORY.exec(`${target}/`)?.[2];
    return from && into && from !== into ? `adapter "${from}" imports adapter "${into}"` : undefined;
  }

  private workspaceProblem(args: {
    owner: string;
    layer: Layer;
    manifest: PackageManifest | undefined;
    specifier: string;
  }): string | undefined {
    const name = LayerScanner.packageName(args.specifier);
    const target = name.slice(SCOPE.length);
    const targetLayer = LAYER_OF_PACKAGE[target];
    if (args.specifier !== name) return `import ${name} by its root, not ${args.specifier}`;
    if (!targetLayer) return `${name} is not in the layer map`;
    if (target === args.owner) return `package imports itself by name`;
    if (!MAY_IMPORT[args.layer].includes(targetLayer)) {
      return targetLayer === "adapter" && args.layer === "adapter"
        ? `adapter "${args.owner}" imports adapter "${target}"`
        : `${args.layer} must not import ${targetLayer} (${name})`;
    }
    return this.isDeclared({ manifest: args.manifest, name })
      ? undefined
      : `${name} is not declared in packages/${args.owner}/package.json`;
  }

  private isDeclared(args: { manifest: PackageManifest | undefined; name: string }): boolean {
    const m = args.manifest;
    if (!m) return false;
    return [m.dependencies, m.devDependencies, m.peerDependencies].some((group) => group !== undefined && args.name in group);
  }

  private manifestOf(owner: string): PackageManifest | undefined {
    const file = `packages/${owner}/package.json`;
    return this.tree.exists(file) ? (JSON.parse(this.tree.readText(file)) as PackageManifest) : undefined;
  }

  private static packageName(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
  }
}
