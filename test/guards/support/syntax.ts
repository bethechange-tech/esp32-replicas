import ts from "typescript";

export interface ModuleReference {
  readonly specifier: string;
  readonly node: ts.Node;
}

export class Syntax {
  private constructor() {}

  static visit(args: { node: ts.Node; visitor: (node: ts.Node) => void }): void {
    args.visitor(args.node);
    ts.forEachChild(args.node, (child) => Syntax.visit({ node: child, visitor: args.visitor }));
  }

  static line(args: { sourceFile: ts.SourceFile; node: ts.Node }): number {
    return args.sourceFile.getLineAndCharacterOfPosition(args.node.getStart(args.sourceFile)).line + 1;
  }

  static hasModifier(args: { node: ts.Node; kind: ts.SyntaxKind }): boolean {
    return ts.canHaveModifiers(args.node) && (ts.getModifiers(args.node) ?? []).some((m) => m.kind === args.kind);
  }

  /** Every way a module is named: import, export-from, import(), require() and import-equals. */
  static moduleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
    const found: ModuleReference[] = [];
    Syntax.visit({
      node: sourceFile,
      visitor: (node) => {
        const specifier = Syntax.specifierOf(node);
        if (specifier !== undefined) found.push({ specifier, node });
      },
    });
    return found;
  }

  private static specifierOf(node: ts.Node): string | undefined {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      return ts.isStringLiteral(expression) ? expression.text : undefined;
    }
    if (ts.isCallExpression(node) && Syntax.isModuleCall(node)) {
      const [first] = node.arguments;
      return first && ts.isStringLiteralLike(first) ? first.text : undefined;
    }
    return undefined;
  }

  private static isModuleCall(call: ts.CallExpression): boolean {
    return (
      call.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(call.expression) && call.expression.text === "require")
    );
  }

  static enclosingClassName(node: ts.Node): string | undefined {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (ts.isClassLike(current)) return current.name?.text;
    }
    return undefined;
  }

  static describe(node: ts.Node): string {
    const own = Syntax.ownName(node);
    const owner = Syntax.enclosingClassName(node);
    return owner && ts.isMethodDeclaration(node) ? `${owner}.${own}` : own;
  }

  private static ownName(node: ts.Node): string {
    if (ts.isConstructorDeclaration(node)) return `${Syntax.enclosingClassName(node) ?? "?"}.constructor`;
    if ("name" in node && node.name && ts.isIdentifier(node.name as ts.Node)) return (node.name as ts.Identifier).text;
    if ("name" in node && node.name && ts.isStringLiteral(node.name as ts.Node)) return (node.name as ts.StringLiteral).text;
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    return "<anonymous>";
  }
}
