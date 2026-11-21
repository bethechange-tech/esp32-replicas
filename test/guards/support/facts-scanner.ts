import ts from "typescript";
import { PublicSource } from "../../../packages/core/src/board-facts";
import { ReportBuilder, type GuardReport } from "./guard-report";
import type { ParsedFile, SourceTree } from "./source-tree";
import { Syntax } from "./syntax";

const RULE = "facts-have-public-sources";
const FACTS_FILE = "facts/boards.json";
const BOARD_FILES = "packages/boards/";
const DEVICE_FILES = "packages/devices/";
const ALLOWED_BARE_NUMBERS: ReadonlySet<number> = new Set([0, 1]);
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Every fact in the facts file has a public source, and every number there has a unit. */
export class FactsFileScanner {
  constructor(private readonly tree: SourceTree) {}

  scan(): GuardReport {
    const report = new ReportBuilder();
    if (!this.tree.exists(FACTS_FILE)) return report.build();
    report.read(FACTS_FILE);
    this.visit({ value: JSON.parse(this.tree.readText(FACTS_FILE)) as unknown, where: "$", report });
    return report.build();
  }

  private visit(args: { value: unknown; where: string; report: ReportBuilder }): void {
    if (Array.isArray(args.value)) {
      args.value.forEach((item, index) => this.visit({ value: item, where: `${args.where}[${index}]`, report: args.report }));
      return;
    }
    if (typeof args.value !== "object" || args.value === null) return;
    const record = args.value as Record<string, unknown>;
    if ("value" in record) this.checkFact({ record, where: args.where, report: args.report });
    for (const [key, child] of Object.entries(record)) {
      this.visit({ value: child, where: `${args.where}.${key}`, report: args.report });
    }
  }

  private checkFact(args: { record: Record<string, unknown>; where: string; report: ReportBuilder }): void {
    const { record, where, report } = args;
    const offend = (message: string): void => report.offend({ file: FACTS_FILE, line: 0, rule: RULE, message: `${where}: ${message}` });
    if (typeof record.source !== "string" || !PublicSource.isPublic(record.source)) offend("a fact needs a public https source");
    if (typeof record.value === "number" && (typeof record.unit !== "string" || record.unit === "")) offend("a number needs its unit");
  }
}

/** A board file holds no number but 0 and 1: pins, addresses and sizes come from the facts file. A device file may name register constants. */
export class NumericLiteralScanner {
  constructor(private readonly tree: SourceTree) {}

  scan(): GuardReport {
    const report = new ReportBuilder();
    for (const file of this.tree.files()) {
      if (!file.path.startsWith(BOARD_FILES) && !file.path.startsWith(DEVICE_FILES)) continue;
      report.read(file.path);
      Syntax.visit({ node: file.sourceFile, visitor: (node) => this.scanNode({ file, node, report }) });
    }
    return report.build();
  }

  private scanNode(args: { file: ParsedFile; node: ts.Node; report: ReportBuilder }): void {
    const { node } = args;
    if (!ts.isNumericLiteral(node) || ALLOWED_BARE_NUMBERS.has(Number(node.text))) return;
    const isDevice = args.file.path.startsWith(DEVICE_FILES);
    if (isDevice && NumericLiteralScanner.isNamed(node)) return;
    args.report.offend({
      file: args.file.path,
      line: Syntax.line({ sourceFile: args.file.sourceFile, node }),
      rule: RULE,
      message: isDevice ? `number ${node.text} outside a named constant` : `number ${node.text} in a board file: it belongs in the facts file`,
    });
  }

  private static isNamed(literal: ts.NumericLiteral): boolean {
    for (let current: ts.Node | undefined = literal.parent; current; current = current.parent) {
      if (ts.isLiteralTypeNode(current) || ts.isEnumMember(current)) return true;
      if (ts.isPropertyDeclaration(current)) {
        return Syntax.hasModifier({ node: current, kind: ts.SyntaxKind.StaticKeyword }) && Syntax.hasModifier({ node: current, kind: ts.SyntaxKind.ReadonlyKeyword });
      }
      if (ts.isVariableDeclaration(current)) return NumericLiteralScanner.isNamedConstant(current);
    }
    return false;
  }

  private static isNamedConstant(declaration: ts.VariableDeclaration): boolean {
    const list = declaration.parent;
    const atTop = ts.isVariableDeclarationList(list) && ts.isSourceFile(list.parent.parent);
    return atTop && (list.flags & ts.NodeFlags.Const) !== 0 && ts.isIdentifier(declaration.name) && CONSTANT_NAME.test(declaration.name.text);
  }
}
