import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentsDocument } from "./support/agents-document";
import { RepositoryRoot } from "./support/temp-tree";

const GUARD_DIRECTORY = "test/guards";

function read(relative: string): string {
  return readFileSync(path.join(RepositoryRoot.PATH, relative), "utf8");
}

function guardFiles(): string[] {
  return readdirSync(path.join(RepositoryRoot.PATH, GUARD_DIRECTORY))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => `${GUARD_DIRECTORY}/${f}`);
}

describe("agents-names-real-guards", () => {
  it("reads the design's rule list, and finds the rules the design marks as written or adapted", () => {
    const rules = AgentsDocument.designRules(read("docs/design.md"));
    expect(rules).toEqual(expect.arrayContaining(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"]));
  });

  it("every design rule has an AGENTS.md section, and every section names a guard or says how it is held", () => {
    expect(AgentsDocument.problems({ design: read("docs/design.md"), agents: read("AGENTS.md") })).toEqual([]);
  });

  it("every guard AGENTS.md names exists", () => {
    const named = AgentsDocument.guardPaths(read("AGENTS.md"));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((p) => !existsSync(path.join(RepositoryRoot.PATH, p)))).toEqual([]);
  });

  it("every guard in test/guards is named in AGENTS.md", () => {
    const named = new Set(AgentsDocument.guardPaths(read("AGENTS.md")));
    expect(guardFiles().filter((f) => !named.has(f))).toEqual([]);
  });

  describe("breaks-on", () => {
    const design = [
      "## 6. The rules",
      "| Rule | Here |",
      "| §1 First rule | **As written.** |",
      "| §18 Rules live in TypeScript | **Adapted**: not Rust |",
      "| Other things | **Do not apply.** |",
      "## 7. Open source",
    ].join("\n");
    const agents = (extra: string): string =>
      `### First\n\nRule: §1\nGuard: \`test/guards/classes-only.test.ts\`\n\n${extra}`;

    it("a document that covers the design passes (the control)", () => {
      expect(AgentsDocument.designRules(design)).toEqual(["1", "18"]);
      expect(AgentsDocument.problems({ design, agents: agents("### Second\n\nRule: §18\nFor review.\n") })).toEqual([]);
    });

    it("a design rule with no section is reported", () => {
      expect(AgentsDocument.problems({ design, agents: agents("") })).toEqual(["design rule §18 has no section"]);
    });

    it("a section that names no guard and does not say it is for review is reported", () => {
      const problems = AgentsDocument.problems({ design, agents: agents("### Second\n\nRule: §18\nSome prose.\n") });
      expect(problems).toEqual(['"Second" neither names a guard nor says "For review" or "Enforced by lint"']);
    });

    it("a section that claims a rule the design does not list is reported", () => {
      const problems = AgentsDocument.problems({ design, agents: agents("### Second\n\nRule: §18, §99\nFor review.\n") });
      expect(problems).toEqual(["a section names §99, which the design does not list"]);
    });

    it("a named guard that does not exist is found by the existence check", () => {
      const named = AgentsDocument.guardPaths("`test/guards/ghost.test.ts`");
      expect(named).toEqual(["test/guards/ghost.test.ts"]);
      expect(existsSync(path.join(RepositoryRoot.PATH, named[0] ?? ""))).toBe(false);
    });
  });
});
