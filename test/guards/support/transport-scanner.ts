import ts from "typescript";
import { ReportBuilder, type GuardReport } from "./guard-report";
import type { ParsedFile, SourceTree } from "./source-tree";
import { Syntax } from "./syntax";

const RULE = "transport-confined";
const GLOBAL_OBJECTS: readonly string[] = ["globalThis", "global", "window", "self"];

export interface ConfinedTechnology {
  readonly name: string;
  readonly modules: readonly string[];
  readonly identifiers: readonly string[];
  readonly allowedDirectories: readonly string[];
}

/** Each technology is allowed in its own adapter directories and nowhere else. */
export class Confinement {
  static readonly TECHNOLOGIES: readonly ConfinedTechnology[] = [
    {
      name: "sockets and tls",
      modules: ["net", "tls", "dgram", "http", "https", "http2", "dns"],
      identifiers: [],
      allowedDirectories: ["packages/network/src/adapters/node/"],
    },
    {
      name: "the mqtt broker library",
      modules: ["aedes", "mqtt", "mqtt-packet", "mosca"],
      identifiers: [],
      allowedDirectories: ["packages/network/src/adapters/node/"],
    },
    { name: "child processes (build scripts only)", modules: ["child_process"], identifiers: [], allowedDirectories: [] },
    {
      name: "the wasm c abi",
      modules: [],
      identifiers: ["WebAssembly"],
      allowedDirectories: ["packages/engine/src/adapters/wasm/"],
    },
    {
      name: "fetch",
      modules: [],
      identifiers: ["fetch"],
      allowedDirectories: ["packages/firmware/src/adapters/download/"],
    },
  ];

  private constructor() {}
}

export class TransportScanner {
  constructor(
    private readonly tree: SourceTree,
    private readonly technologies: readonly ConfinedTechnology[],
  ) {}

  scan(): GuardReport {
    const report = new ReportBuilder();
    for (const file of this.tree.files()) {
      report.read(file.path);
      this.scanImports({ file, report });
      Syntax.visit({ node: file.sourceFile, visitor: (node) => this.scanIdentifier({ file, node, report }) });
    }
    return report.build();
  }

  private scanImports(args: { file: ParsedFile; report: ReportBuilder }): void {
    for (const reference of Syntax.moduleReferences(args.file.sourceFile)) {
      const bare = reference.specifier.replace(/^node:/, "");
      const technology = this.technologies.find((t) => t.modules.includes(bare));
      if (technology) this.check({ ...args, technology, node: reference.node, what: `import of ${reference.specifier}` });
    }
  }

  private scanIdentifier(args: { file: ParsedFile; node: ts.Node; report: ReportBuilder }): void {
    if (!ts.isIdentifier(args.node)) return;
    const technology = this.technologies.find((t) => t.identifiers.includes((args.node as ts.Identifier).text));
    if (!technology || !TransportScanner.isUse(args.node)) return;
    this.check({ file: args.file, report: args.report, technology, node: args.node, what: `use of ${args.node.text}` });
  }

  private check(args: {
    file: ParsedFile;
    report: ReportBuilder;
    technology: ConfinedTechnology;
    node: ts.Node;
    what: string;
  }): void {
    if (args.technology.allowedDirectories.some((dir) => args.file.path.startsWith(dir))) return;
    args.report.offend({
      file: args.file.path,
      line: Syntax.line({ sourceFile: args.file.sourceFile, node: args.node }),
      rule: RULE,
      message: `${args.what} (${args.technology.name}) outside ${args.technology.allowedDirectories.join(", ") || "any adapter"}`,
    });
  }

  /** A name used as a value or a namespace. A member that merely shares the name (`client.fetch`) is not a use. */
  private static isUse(identifier: ts.Identifier): boolean {
    const parent = identifier.parent;
    if (ts.isPropertyAccessExpression(parent)) {
      if (parent.expression === identifier) return true;
      return ts.isIdentifier(parent.expression) && GLOBAL_OBJECTS.includes(parent.expression.text);
    }
    if (ts.isQualifiedName(parent)) return parent.left === identifier;
    return (
      (ts.isCallExpression(parent) && (parent.expression === identifier || parent.arguments.some((a) => a === identifier))) ||
      (ts.isVariableDeclaration(parent) && parent.initializer === identifier) ||
      (ts.isBinaryExpression(parent) && parent.right === identifier) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === identifier) ||
      (ts.isNewExpression(parent) && parent.expression === identifier)
    );
  }
}
