const FOR_REVIEW = "For review";
const BY_LINT = "Enforced by lint";
const GUARD_PATH = /test\/guards\/[a-z0-9-]+\.test\.ts/g;
const DESIGN_RULE = /§(\d+[a-z]?)/g;
const RULE_LINE = /^Rule: (.*)$/m;
const RULES_SECTION_START = "## 6. ";
const RULES_SECTION_END = "## 7. ";
const KEPT_RULE_MARKERS: readonly string[] = ["**As written", "**Adapted"];

/** AGENTS.md is checked against the rule table in docs/design.md §6, so there is one list of rules, not two. */
export class AgentsDocument {
  private constructor() {}

  /** Rule numbers (§1, §2, ...) of the rows of design §6 marked "As written" or "Adapted". */
  static designRules(design: string): string[] {
    const start = design.indexOf(RULES_SECTION_START);
    const end = design.indexOf(RULES_SECTION_END);
    const rows = design.slice(start, end).split("\n").filter((line) => line.startsWith("| §"));
    const kept = rows.filter((row) => KEPT_RULE_MARKERS.some((m) => row.includes(m)));
    return kept.flatMap((row) => [...(row.split("|")[1] ?? "").matchAll(DESIGN_RULE)].map((m) => m[1] ?? ""));
  }

  static guardPaths(document: string): string[] {
    return [...new Set(document.match(GUARD_PATH) ?? [])].sort();
  }

  static problems(args: { design: string; agents: string }): string[] {
    const sections = AgentsDocument.sections(args.agents);
    const claimed = new Map<string, string[]>();
    const problems: string[] = [];
    for (const [heading, body] of sections) {
      if (!AgentsDocument.isAccountedFor(body)) problems.push(`"${heading}" neither names a guard nor says "${FOR_REVIEW}" or "${BY_LINT}"`);
      for (const rule of AgentsDocument.claimedRules(body)) claimed.set(rule, [...(claimed.get(rule) ?? []), heading]);
    }
    const required = AgentsDocument.designRules(args.design);
    for (const rule of required) if (!claimed.has(rule)) problems.push(`design rule §${rule} has no section`);
    for (const rule of claimed.keys()) if (!required.includes(rule)) problems.push(`a section names §${rule}, which the design does not list`);
    return problems;
  }

  private static isAccountedFor(body: string): boolean {
    return AgentsDocument.guardPaths(body).length > 0 || body.includes(FOR_REVIEW) || body.includes(BY_LINT);
  }

  private static claimedRules(body: string): string[] {
    const line = RULE_LINE.exec(body)?.[1] ?? "";
    return [...line.matchAll(DESIGN_RULE)].map((m) => m[1] ?? "");
  }

  private static sections(document: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const part of document.split(/^### /m).slice(1)) {
      const newline = part.indexOf("\n");
      result.set(part.slice(0, newline).trim(), part.slice(newline));
    }
    return result;
  }
}
