import ts from "typescript";
import { ReportBuilder, SanctionLedger, type GuardReport, type Sanction } from "./guard-report";
import type { ParsedFile, SourceTree } from "./source-tree";
import { Syntax } from "./syntax";

const RULE = "no-product-names";
/** packages/<name>/src/<directory>: the first path that names a directory below src. */
const FIRST_DIRECTORY_END = 4;

/** Products, vendors and libraries. Protocols and standards (Mqtt, Http, I2c, Spi) and chip families are allowed. */
export class ProductNames {
  static readonly LISTED: readonly string[] = [
    "waveshare",
    "elecrow",
    "crowpanel",
    "esp32sim",
    "espressif",
    "esphome",
    "espidf",
    "mosquitto",
    "aedes",
    "rustls",
    "mikroverk",
    "emqx",
    "hivemq",
    "lvgl",
    "docker",
    "prisma",
    "axios",
  ];

  private constructor() {}

  static within(identifier: string): string | undefined {
    const lower = identifier.toLowerCase();
    return ProductNames.LISTED.find((name) => lower.includes(name));
  }
}

/** Exported identifiers and the directories under a package's src. A sanction names a directory by its exact path. */
export class ProductNameScanner {
  constructor(
    private readonly tree: SourceTree,
    private readonly sanctions: readonly Sanction[],
  ) {}

  scan(): GuardReport {
    const ledger = new SanctionLedger(this.sanctions);
    const report = new ReportBuilder();
    const directories = new Set<string>();
    for (const file of this.tree.files()) {
      report.read(file.path);
      this.scanIdentifiers({ file, report });
      ProductNameScanner.directoriesOf(file.path).forEach((d) => directories.add(d));
    }
    for (const directory of directories) this.scanDirectory({ directory, ledger, report });
    report.addAll(ledger.stale(RULE));
    return report.build();
  }

  private scanDirectory(args: { directory: string; ledger: SanctionLedger; report: ReportBuilder }): void {
    const leaf = args.directory.split("/").pop() ?? "";
    const product = ProductNames.within(leaf);
    if (!product) return;
    if (args.ledger.covers({ file: args.directory, name: leaf })) {
      args.ledger.claim({ file: args.directory, name: leaf });
      return;
    }
    args.report.offend({ file: args.directory, line: 0, rule: RULE, message: `directory name contains product name "${product}"` });
  }

  private scanIdentifiers(args: { file: ParsedFile; report: ReportBuilder }): void {
    for (const statement of args.file.sourceFile.statements) {
      for (const name of ProductNameScanner.exportedNames(statement)) {
        const product = ProductNames.within(name.text);
        if (!product) continue;
        args.report.offend({
          file: args.file.path,
          line: Syntax.line({ sourceFile: args.file.sourceFile, node: name }),
          rule: RULE,
          message: `exported "${name.text}" contains product name "${product}"`,
        });
      }
    }
  }

  private static exportedNames(statement: ts.Statement): (ts.Identifier | ts.StringLiteral)[] {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.map((e) => e.name);
    }
    if (!Syntax.hasModifier({ node: statement, kind: ts.SyntaxKind.ExportKeyword })) return [];
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name] : []));
    }
    const named = statement as ts.Statement & { name?: ts.Node };
    return named.name && ts.isIdentifier(named.name) ? [named.name] : [];
  }

  private static directoriesOf(file: string): string[] {
    const segments = file.split("/");
    const result: string[] = [];
    for (let end = FIRST_DIRECTORY_END; end < segments.length; end += 1) result.push(segments.slice(0, end).join("/"));
    return result;
  }
}
