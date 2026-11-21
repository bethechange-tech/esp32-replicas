import ts from "typescript";
import { ReportBuilder, type GuardReport } from "./guard-report";
import type { ParsedFile, SourceTree } from "./source-tree";
import { Syntax } from "./syntax";

const RULE = "one-configuration-reader";
const READER_CLASS = "ConfigurationReader";
const PROCESS_MODULES: readonly string[] = ["process", "node:process"];
const GLOBAL_OBJECTS: readonly string[] = ["globalThis", "global", "window", "self"];

/** `process.env` is read only inside the `ConfigurationReader` class, in a file the plan names. It does not see a key built from a run-time string. */
export class ConfigurationScanner {
  constructor(
    private readonly tree: SourceTree,
    private readonly readerFiles: readonly string[],
  ) {}

  scan(): GuardReport {
    const report = new ReportBuilder();
    for (const file of this.tree.files()) {
      report.read(file.path);
      Syntax.visit({ node: file.sourceFile, visitor: (node) => this.scanNode({ file, node, report }) });
    }
    return report.build();
  }

  private scanNode(args: { file: ParsedFile; node: ts.Node; report: ReportBuilder }): void {
    const problem = this.problemWith(args.node);
    if (!problem || this.isInsideReader({ file: args.file.path, node: args.node })) return;
    args.report.offend({
      file: args.file.path,
      line: Syntax.line({ sourceFile: args.file.sourceFile, node: args.node }),
      rule: RULE,
      message: problem,
    });
  }

  private isInsideReader(args: { file: string; node: ts.Node }): boolean {
    return Syntax.enclosingClassName(args.node) === READER_CLASS && this.readerFiles.includes(args.file);
  }

  private problemWith(node: ts.Node): string | undefined {
    if (ts.isPropertyAccessExpression(node) && ConfigurationScanner.isEnvOf(node)) return "environment read outside ConfigurationReader";
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "env") {
      return "environment read by element access outside ConfigurationReader";
    }
    if (ts.isPropertyAccessExpression(node) && ConfigurationScanner.isGlobalProcess(node)) {
      return "process reached through the global object";
    }
    if (ts.isIdentifier(node) && node.text === "process" && ConfigurationScanner.isAliased(node)) {
      return "process is aliased, which hides what reads the environment";
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && PROCESS_MODULES.includes(node.moduleSpecifier.text)) {
      return "process is imported by name, which hides what reads the environment";
    }
    return undefined;
  }

  private static isEnvOf(node: ts.PropertyAccessExpression): boolean {
    if (node.name.text !== "env") return false;
    const owner = node.expression;
    return (ts.isIdentifier(owner) && owner.text === "process") || owner.kind === ts.SyntaxKind.MetaProperty;
  }

  private static isGlobalProcess(node: ts.PropertyAccessExpression): boolean {
    return node.name.text === "process" && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.includes(node.expression.text);
  }

  private static isAliased(identifier: ts.Identifier): boolean {
    const parent = identifier.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === identifier) return false;
    if (ts.isElementAccessExpression(parent) && parent.expression === identifier) return false;
    return (
      (ts.isVariableDeclaration(parent) && parent.initializer === identifier) ||
      (ts.isCallExpression(parent) && parent.arguments.some((a) => a === identifier)) ||
      (ts.isBinaryExpression(parent) && parent.right === identifier) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === identifier)
    );
  }
}
