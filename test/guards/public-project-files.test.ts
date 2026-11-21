import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PublicFiles, WorkflowChecker } from "./support/public-files";
import { RepositoryRoot } from "./support/temp-tree";

const CI_FILE = ".github/workflows/ci.yml";

function read(relative: string): string {
  return readFileSync(path.join(RepositoryRoot.PATH, relative), "utf8");
}

describe("public-project-files", () => {
  for (const expectation of PublicFiles.EXPECTATIONS) {
    it(`${expectation.file} exists and says what the plan lists`, () => {
      const text = read(expectation.file).toLowerCase();
      const missing = expectation.mustSay.filter((phrase) => !text.includes(phrase.toLowerCase()));
      expect(missing).toEqual([]);
    });
  }

  it("ci.yml has contents: read, no secrets, and every action pinned by SHA", () => {
    const yaml = read(CI_FILE);
    expect(WorkflowChecker.problems(yaml)).toEqual([]);
    expect(yaml).toContain("uses: actions/checkout@");
  });

  describe("breaks-on", () => {
    const pinned = "a".repeat(40);
    const workflow = (extra: string): string =>
      `name: ci\non: push\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${pinned}\n        with:\n          persist-credentials: false\n${extra}`;

    it("a clean workflow passes (the control)", () => {
      expect(WorkflowChecker.problems(workflow(""))).toEqual([]);
    });

    it("a checkout that keeps credentials", () => {
      const bare = workflow("").replace("        with:\n          persist-credentials: false\n", "");
      expect(WorkflowChecker.problems(bare)).toEqual(["checkout must set persist-credentials: false"]);
    });

    it("an action pinned by tag", () => {
      expect(WorkflowChecker.problems(workflow("      - uses: actions/setup-node@v4\n"))).toEqual([
        "action actions/setup-node@v4 is not pinned by a full commit SHA",
      ]);
    });

    it("write permission, a job that widens permissions, and a mention of secrets", () => {
      expect(WorkflowChecker.problems(workflow("").replace("contents: read", "contents: write"))).toEqual([
        "permissions must be exactly contents: read",
      ]);
      expect(WorkflowChecker.problems(workflow("").replace("    runs-on", "    permissions:\n      id-token: write\n    runs-on"))).toEqual([
        "job check widens permissions",
      ]);
      expect(WorkflowChecker.problems(workflow("      - run: echo ${{ secrets.TOKEN }}\n"))).toEqual(["the workflow mentions secrets"]);
    });

    it("a missing phrase in a public file is reported", () => {
      const text = "A readme that names no board";
      expect(PublicFiles.EXPECTATIONS.find((e) => e.file === "README.md")?.mustSay.filter((p) => !text.includes(p))).toContain("panel-7");
    });
  });
});
