import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SourceTree } from "./source-tree";
import type { GuardReport } from "./guard-report";

/** A scratch repository in a temporary directory, never inside the tracked tree. */
export class TempTree {
  private constructor(readonly root: string) {}

  static create(files: Readonly<Record<string, string>>): TempTree {
    const root = mkdtempSync(path.join(tmpdir(), "guard-fixture-"));
    for (const [relative, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), content);
    }
    return new TempTree(root);
  }

  tree(): SourceTree {
    return new SourceTree(this.root);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  static manifest(args: { name: string; dependencies?: readonly string[] }): string {
    const deps = Object.fromEntries((args.dependencies ?? []).map((d) => [d, "workspace:*"]));
    return JSON.stringify({ name: `@replicas/${args.name}`, dependencies: deps });
  }

  /** Runs a scan on a scratch tree, then removes it. */
  static scanning(args: { files: Readonly<Record<string, string>>; scan: (tree: SourceTree) => GuardReport }): GuardReport {
    const temp = TempTree.create(args.files);
    try {
      return args.scan(temp.tree());
    } finally {
      temp.dispose();
    }
  }
}

export class RepositoryRoot {
  static readonly PATH = path.resolve(import.meta.dirname, "../../..");

  private constructor() {}
}
