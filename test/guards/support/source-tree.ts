import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface ParsedFile {
  readonly path: string;
  readonly sourceFile: ts.SourceFile;
}

const NON_PRODUCTION_DIRECTORIES: ReadonlySet<string> = new Set(["test", "tests", "fakes", "__tests__", "node_modules"]);
const NON_PRODUCTION_SUFFIXES: readonly string[] = [".test.ts", ".contract.ts", ".d.ts"];

export class SourceTree {
  constructor(private readonly root: string) {}

  files(): ParsedFile[] {
    return this.listProductionPaths().map((relative) => ({
      path: relative,
      sourceFile: ts.createSourceFile(
        relative,
        readFileSync(path.join(this.root, relative), "utf8"),
        ts.ScriptTarget.ES2023,
        true,
      ),
    }));
  }

  readText(relative: string): string {
    return readFileSync(path.join(this.root, relative), "utf8");
  }

  exists(relative: string): boolean {
    try {
      statSync(path.join(this.root, relative));
      return true;
    } catch {
      return false;
    }
  }

  static packageOf(file: string): string | undefined {
    const match = /^packages\/([^/]+)\//.exec(file);
    return match?.[1];
  }

  private listProductionPaths(): string[] {
    const packagesDir = path.join(this.root, "packages");
    if (!this.exists("packages")) return [];
    return readdirSync(packagesDir)
      .flatMap((name) => this.walk(`packages/${name}/src`))
      .filter((file) => NON_PRODUCTION_SUFFIXES.every((suffix) => !file.endsWith(suffix)))
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .sort();
  }

  private walk(relativeDir: string): string[] {
    if (!this.exists(relativeDir)) return [];
    return readdirSync(path.join(this.root, relativeDir)).flatMap((entry) => {
      const relative = `${relativeDir}/${entry}`;
      if (NON_PRODUCTION_DIRECTORIES.has(entry)) return [];
      return statSync(path.join(this.root, relative)).isDirectory() ? this.walk(relative) : [relative];
    });
  }
}
