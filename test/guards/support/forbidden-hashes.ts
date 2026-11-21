import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Sha256Token } from "./sha256-token.ts";

const LOCAL_LIST = ".private-hashes";

/** Tracked digests of private host names and key prefixes: none, because a hash of a guessable name still names it. Keep them in the untracked `.private-hashes` (see `all`); a prefix matches any token that starts with it. Make one with `pnpm guard:hash <name>`. */
export class ForbiddenHashes {
  static readonly LIST: readonly string[] = [];

  static readonly ALLOWED_EMAIL_DOMAINS: readonly string[] = ["example.com", "example.org", "example.net", "users.noreply.github.com"];

  /** Pinned by exact path; an exemption that exempts nothing is an offence. */
  static readonly EMAIL_EXEMPT_FILES: readonly string[] = [];

  /** The tracked list plus an optional, untracked `.private-hashes` file (one digest per line) that a maintainer keeps locally. */
  static all(root: string): string[] {
    const file = path.join(root, LOCAL_LIST);
    if (!existsSync(file)) return [...ForbiddenHashes.LIST];
    const local = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => Sha256Token.isDigest(l));
    return [...ForbiddenHashes.LIST, ...local];
  }

  static hashOf(name: string): string {
    return Sha256Token.of(name);
  }

  private constructor() {}
}
