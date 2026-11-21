import { parse } from "yaml";

export interface FileExpectation {
  readonly file: string;
  readonly mustSay: readonly string[];
}

export class PublicFiles {
  static readonly EXPECTATIONS: readonly FileExpectation[] = [
    { file: "LICENSE", mustSay: ["MIT License", "Permission is hereby granted"] },
    {
      file: "NOTICE.md",
      mustSay: ["esp32sim", "Joakim Eriksson", "Apache-2.0", "LICENSE-ADC", "ROM", "ESPHome", "GPLv3"],
    },
    {
      file: "README.md",
      mustSay: ["small-screen", "small-screen-touch", "panel-7", "headless", "## Scope", "out of scope", "## Quick start", "## Bring your own image", "--image"],
    },
    {
      file: "CONTRIBUTING.md",
      mustSay: ["Node", "pnpm", "Rust", "Docker", "pnpm check", "Goldens", "AGENTS.md", "out of scope"],
    },
    { file: "CODE_OF_CONDUCT.md", mustSay: ["Contributor Covenant", "version 2.1", "## Enforcement Guidelines"] },
    { file: "SECURITY.md", mustSay: ["private vulnerability reporting", "Do not report it in a public issue"] },
    { file: ".github/ISSUE_TEMPLATE/bug.yml", mustSay: ["out of scope", "small-screen", "panel-7"] },
    { file: ".github/ISSUE_TEMPLATE/config.yml", mustSay: ["out of scope", "blank_issues_enabled: false"] },
    { file: ".github/PULL_REQUEST_TEMPLATE.md", mustSay: ["Checks run", "Goldens"] },
  ];

  private constructor() {}
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const SECRETS_WORD = /\bsecrets\b/i;

interface WorkflowDocument {
  readonly permissions?: Record<string, string>;
  readonly jobs?: Record<string, { permissions?: unknown; steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
}

/** What `ci.yml` must keep true: read-only token, no secrets, every action pinned by commit SHA. */
export class WorkflowChecker {
  private constructor() {}

  static problems(yaml: string): string[] {
    const document = parse(yaml) as WorkflowDocument;
    const problems: string[] = [];
    const topLevel = document.permissions;
    if (!topLevel || topLevel.contents !== "read" || Object.keys(topLevel).length !== 1) {
      problems.push("permissions must be exactly contents: read");
    }
    if (SECRETS_WORD.test(yaml)) problems.push("the workflow mentions secrets");
    for (const [name, job] of Object.entries(document.jobs ?? {})) {
      if (job.permissions !== undefined) problems.push(`job ${name} widens permissions`);
      for (const step of job.steps ?? []) {
        const problem = WorkflowChecker.actionProblem(step.uses);
        if (problem) problems.push(problem);
        if (step.uses?.startsWith("actions/checkout@") && step.with?.["persist-credentials"] !== false) {
          problems.push("checkout must set persist-credentials: false");
        }
      }
    }
    return problems;
  }

  private static actionProblem(uses: string | undefined): string | undefined {
    if (uses === undefined || uses.startsWith("./")) return undefined;
    const ref = uses.split("@")[1];
    return ref !== undefined && FULL_SHA.test(ref) ? undefined : `action ${uses} is not pinned by a full commit SHA`;
  }
}
