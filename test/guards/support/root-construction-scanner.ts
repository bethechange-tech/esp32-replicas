import ts from "typescript";
import { ReportBuilder, SanctionLedger, type GuardReport, type Sanction } from "./guard-report";
import type { ParsedFile, SourceTree } from "./source-tree";
import { Syntax } from "./syntax";

export interface RootConstructionOptions {
  readonly roots: readonly string[];
  readonly sanctions: readonly Sanction[];
}

const RULE = "only-roots-construct";

/** A `new` of an exported concrete class outside a composition root. A class may build itself (a named constructor). */
export class RootConstructionScanner {
  constructor(
    private readonly tree: SourceTree,
    private readonly options: RootConstructionOptions,
  ) {}

  scan(): GuardReport {
    const files = this.tree.files();
    const concrete = RootConstructionScanner.exportedConcreteClasses(files);
    const ledger = new SanctionLedger(this.options.sanctions);
    const report = new ReportBuilder();
    for (const file of files) {
      report.read(file.path);
      if (this.options.roots.includes(file.path)) continue;
      this.scanFile({ file, concrete, ledger, report });
    }
    report.addAll(ledger.stale(RULE));
    return report.build();
  }

  private scanFile(args: {
    file: ParsedFile;
    concrete: ReadonlySet<string>;
    ledger: SanctionLedger;
    report: ReportBuilder;
  }): void {
    const { file } = args;
    const aliases = RootConstructionScanner.importAliases(file);
    Syntax.visit({
      node: file.sourceFile,
      visitor: (node) => {
        if (!ts.isNewExpression(node)) return;
        const written = RootConstructionScanner.constructedName(node);
        const name = written === undefined ? undefined : (aliases.get(written) ?? written);
        if (!name || !args.concrete.has(name)) return;
        if (Syntax.enclosingClassName(node) === name) return;
        if (args.ledger.covers({ file: file.path, name })) {
          args.ledger.claim({ file: file.path, name });
          return;
        }
        args.report.offend({
          file: file.path,
          line: Syntax.line({ sourceFile: file.sourceFile, node }),
          rule: RULE,
          message: `new ${name} outside a composition root`,
        });
      },
    });
  }

  /** `import { A as B }` makes `new B()` a construction of `A`: local name to the exported one. */
  private static importAliases(file: ParsedFile): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const statement of file.sourceFile.statements) {
      const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (element.propertyName) aliases.set(element.name.text, element.propertyName.text);
      }
    }
    return aliases;
  }

  private static constructedName(node: ts.NewExpression): string | undefined {
    const target = node.expression;
    if (ts.isIdentifier(target)) return target.text;
    return ts.isPropertyAccessExpression(target) ? target.name.text : undefined;
  }

  /** A class is exported by its own modifier, by an export list (`export { A as B }`) or by default. */
  private static exportedConcreteClasses(files: readonly ParsedFile[]): Set<string> {
    const names = new Set<string>();
    for (const file of files) {
      const declared = new Map<string, ts.ClassDeclaration>();
      for (const statement of file.sourceFile.statements) {
        if (ts.isClassDeclaration(statement) && statement.name) declared.set(statement.name.text, statement);
      }
      const concrete = (name: string): boolean => {
        const declaration = declared.get(name);
        return declaration !== undefined && !Syntax.hasModifier({ node: declaration, kind: ts.SyntaxKind.AbstractKeyword });
      };
      const expose = (args: { local: string; exposed: string }): void => {
        if (!concrete(args.local)) return;
        names.add(args.local);
        names.add(args.exposed);
      };
      for (const [name, declaration] of declared) {
        if (Syntax.hasModifier({ node: declaration, kind: ts.SyntaxKind.ExportKeyword })) expose({ local: name, exposed: name });
      }
      for (const statement of file.sourceFile.statements) {
        RootConstructionScanner.exportListNames(statement).forEach(expose);
      }
    }
    return names;
  }

  private static exportListNames(statement: ts.Statement): { local: string; exposed: string }[] {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      return [{ local: statement.expression.text, exposed: "default" }];
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) return [];
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return [];
    return statement.exportClause.elements.map((e) => ({ local: (e.propertyName ?? e.name).text, exposed: e.name.text }));
  }
}
