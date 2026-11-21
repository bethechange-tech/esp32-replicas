import { execFileSync } from "node:child_process";

/** What git's attributes would do to a file when it stores it. */
export class GitAttributes {
  private constructor() {}

  /** The files git would convert (its `text` attribute is anything but `unset`), so its stored bytes are not the file's. */
  static converted(args: { root: string; files: readonly string[] }): string[] {
    if (args.files.length === 0) return [];
    const out = execFileSync("git", ["check-attr", "-z", "--stdin", "text"], {
      cwd: args.root,
      encoding: "utf8",
      input: `${args.files.join("\0")}\0`,
    });
    const fields = out.split("\0");
    const converted: string[] = [];
    for (let at = 0; at + 2 < fields.length; at += 3) {
      if (fields[at + 2] !== "unset") converted.push(fields[at] ?? "");
    }
    return converted;
  }
}
