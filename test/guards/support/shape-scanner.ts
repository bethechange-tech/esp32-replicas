import ts from "typescript";
import { ReportBuilder, SanctionLedger, type GuardReport, type Sanction } from "./guard-report";
import type { ParsedFile, SourceTree } from "./source-tree";
import { Syntax } from "./syntax";

const CLASSES_ONLY = "classes-only";
const TWO_ARGUMENTS = "two-arguments-at-most";
const MAX_PARAMETERS = 2;

const FUNCTION_LIKE_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.ConstructorType,
]);

/** No top-level function, and a class of only static members has a private constructor. */
export class ClassesOnlyScanner {
  constructor(
    private readonly tree: SourceTree,
    private readonly sanctions: readonly Sanction[],
  ) {}

  scan(): GuardReport {
    const ledger = new SanctionLedger(this.sanctions);
    const report = new ReportBuilder();
    for (const file of this.tree.files()) {
      report.read(file.path);
      for (const statement of file.sourceFile.statements) this.scanStatement({ file, statement, ledger, report });
    }
    report.addAll(ledger.stale(CLASSES_ONLY));
    return report.build();
  }

  private scanStatement(args: {
    file: ParsedFile;
    statement: ts.Statement;
    ledger: SanctionLedger;
    report: ReportBuilder;
  }): void {
    const { file, statement, ledger, report } = args;
    const offend = (message: string, name: string): void => {
      if (ledger.covers({ file: file.path, name })) {
        ledger.claim({ file: file.path, name });
        return;
      }
      report.offend({
        file: file.path,
        line: Syntax.line({ sourceFile: file.sourceFile, node: statement }),
        rule: CLASSES_ONLY,
        message,
      });
    };
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      offend(`top-level function "${name}": make it a static method on a class`, name);
    }
    if (ts.isVariableStatement(statement)) {
      const mutable = (statement.declarationList.flags & ts.NodeFlags.Const) === 0;
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : "<pattern>";
        if (mutable) offend(`module-level let or var "${name}" is mutable state`, name);
        if (!declaration.initializer) continue;
        if (ClassesOnlyScanner.isFunction(declaration.initializer)) {
          offend(`module-level const "${name}" is a function: make it a static method on a class`, name);
        } else if (ClassesOnlyScanner.isObjectOfMethods(declaration.initializer)) {
          offend(`module-level const "${name}" is an object of functions: make it a class`, name);
        }
      }
    }
    if (ts.isExportAssignment(statement) && ClassesOnlyScanner.isFunction(statement.expression)) {
      offend("default-exported function: make it a static method on a class", "default");
    }
    if (ts.isClassDeclaration(statement) && ClassesOnlyScanner.isStaticOnlyWithoutPrivateConstructor(statement)) {
      offend(`class "${statement.name?.text ?? "default"}" has only static members: give it a private constructor`, statement.name?.text ?? "default");
    }
  }

  private static isFunction(expression: ts.Expression): boolean {
    let inner = expression;
    while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
      inner = inner.expression;
    }
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
  }

  private static isObjectOfMethods(expression: ts.Expression): boolean {
    let inner = expression;
    while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
      inner = inner.expression;
    }
    if (!ts.isObjectLiteralExpression(inner)) return false;
    return inner.properties.some(
      (p) => ts.isMethodDeclaration(p) || (ts.isPropertyAssignment(p) && ClassesOnlyScanner.isFunction(p.initializer)),
    );
  }

  private static isStaticOnlyWithoutPrivateConstructor(declaration: ts.ClassDeclaration): boolean {
    const constructors = declaration.members.filter(ts.isConstructorDeclaration);
    const others = declaration.members.filter((m) => !ts.isConstructorDeclaration(m) && !ts.isClassStaticBlockDeclaration(m));
    const staticOnly =
      others.length > 0 && others.every((m) => Syntax.hasModifier({ node: m, kind: ts.SyntaxKind.StaticKeyword }));
    if (!staticOnly) return false;
    return !constructors.some((c) => Syntax.hasModifier({ node: c, kind: ts.SyntaxKind.PrivateKeyword }));
  }
}

/** Never more than two parameters: three or more values become one object. Constructors count. */
export class ParameterCountScanner {
  constructor(
    private readonly tree: SourceTree,
    private readonly sanctions: readonly Sanction[],
  ) {}

  scan(): GuardReport {
    const ledger = new SanctionLedger(this.sanctions);
    const report = new ReportBuilder();
    for (const file of this.tree.files()) {
      report.read(file.path);
      Syntax.visit({
        node: file.sourceFile,
        visitor: (node) => this.scanNode({ file, node, ledger, report }),
      });
    }
    report.addAll(ledger.stale(TWO_ARGUMENTS));
    return report.build();
  }

  private scanNode(args: { file: ParsedFile; node: ts.Node; ledger: SanctionLedger; report: ReportBuilder }): void {
    const { file, node } = args;
    if (!FUNCTION_LIKE_KINDS.has(node.kind)) return;
    const count = (node as ts.SignatureDeclaration).parameters.filter(
      (p) => !(ts.isIdentifier(p.name) && p.name.text === "this"),
    ).length;
    if (count <= MAX_PARAMETERS) return;
    const name = Syntax.describe(node);
    if (args.ledger.covers({ file: file.path, name })) {
      args.ledger.claim({ file: file.path, name });
      return;
    }
    args.report.offend({
      file: file.path,
      line: Syntax.line({ sourceFile: file.sourceFile, node }),
      rule: TWO_ARGUMENTS,
      message: `"${name}" takes ${count} parameters: pass one object`,
    });
  }
}
