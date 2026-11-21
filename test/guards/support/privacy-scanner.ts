import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ReportBuilder, type GuardReport } from "./guard-report";
import { Sha256Token } from "./sha256-token.ts";

const RULE = "nothing-private";
const MAX_OCTET = 255;
const LOOPBACK_FIRST_OCTET = 127;
const MIN_KEY_PREFIX_LENGTH = 4;
/** RFC 5737 documentation ranges, and the emulator's own subnet (10.0.2.0/24). Leading three octets. */
const ALLOWED_NETWORKS: readonly (readonly number[])[] = [
  [192, 0, 2],
  [198, 51, 100],
  [203, 0, 113],
  [10, 0, 2],
];
const MAX_SCANNED_BYTES = 2_000_000;

export interface FileSource {
  list(): string[];
  read(relative: string): Buffer;
}

/** Tracked files plus untracked files that are not ignored: what a commit would publish. */
export class GitFileSource implements FileSource {
  constructor(private readonly root: string) {}

  list(): string[] {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: this.root,
      encoding: "utf8",
    });
    return out.split("\0").filter((f) => f !== "" && FsPaths.isFile({ root: this.root, relative: f }));
  }

  read(relative: string): Buffer {
    return readFileSync(path.join(this.root, relative));
  }
}

export class DirectoryFileSource implements FileSource {
  constructor(private readonly root: string) {}

  list(): string[] {
    return this.walk("");
  }

  read(relative: string): Buffer {
    return readFileSync(path.join(this.root, relative));
  }

  private walk(relative: string): string[] {
    return readdirSync(path.join(this.root, relative)).flatMap((entry) => {
      const next = relative === "" ? entry : `${relative}/${entry}`;
      return statSync(path.join(this.root, next)).isDirectory() ? this.walk(next) : [next];
    });
  }
}

class FsPaths {
  private constructor() {}

  static isFile(args: { root: string; relative: string }): boolean {
    try {
      return statSync(path.join(args.root, args.relative)).isFile();
    } catch {
      return false;
    }
  }
}

/** A pattern is built from pieces so that this file does not contain what it forbids. */
class Patterns {
  private constructor() {}

  static readonly PRIVATE_KEY = new RegExp(["-----BEGIN", "[A-Z ]*", "PRIVATE KEY-----"].join(""));
  static readonly TOKENS: readonly { name: string; pattern: RegExp }[] = [
    { name: "github token", pattern: new RegExp(["gh[pousr]", "_[A-Za-z0-9]{36,}"].join("")) },
    { name: "github fine-grained token", pattern: new RegExp(["github", "_pat_[A-Za-z0-9_]{20,}"].join("")) },
    { name: "npm token", pattern: new RegExp(["npm", "_[A-Za-z0-9]{36}"].join("")) },
    { name: "aws access key", pattern: new RegExp(["AK", "IA[0-9A-Z]{16}"].join("")) },
    { name: "google api key", pattern: new RegExp(["AI", "za[0-9A-Za-z_-]{35}"].join("")) },
    { name: "slack token", pattern: new RegExp(["xo", "x[abprs]-[0-9A-Za-z-]{10,}"].join("")) },
    { name: "secret key", pattern: new RegExp(["s", "k-[A-Za-z0-9]{32,}"].join("")) },
  ];
  static readonly ABSOLUTE_PATH = new RegExp(["/Us", "ers/|/ho", "me/|/Vol", "umes/"].join(""));
  static readonly IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
  static readonly KEY_TOKEN = /[A-Za-z0-9][A-Za-z0-9_-]*/g;
  static readonly HOST = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\b/g;
  static readonly EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
  static readonly CERTIFICATE_FILE = /\.(pem|crt|cer|key|p12|pfx|der|jks)$/i;
  static readonly ENV_FILE = /(^|\/)\.env(\..*)?$/;
}

export interface PrivacyOptions {
  readonly forbiddenHashes: readonly string[];
  /** Domains an email may use: reserved for documentation, or a no-reply address. */
  readonly allowedEmailDomains: readonly string[];
  /** Files that legitimately hold look-alike text (a lock file's package versions). Pinned by exact path. */
  readonly exemptFromEmailScan: readonly string[];
}

export class PrivacyScanner {
  private readonly exemptionsUsed = new Set<string>();

  constructor(
    private readonly files: FileSource,
    private readonly options: PrivacyOptions,
  ) {}

  scan(): GuardReport {
    const report = new ReportBuilder();
    for (const file of this.files.list()) {
      report.read(file);
      this.scanName({ file, report });
      const bytes = this.files.read(file);
      if (bytes.length > MAX_SCANNED_BYTES || bytes.includes(0)) {
        report.skip(file);
        continue;
      }
      this.scanText({ file, text: bytes.toString("utf8"), report });
    }
    this.staleExemptions().forEach((file) =>
      report.offend({ file, line: 0, rule: RULE, message: "email exemption matches nothing" }),
    );
    return report.build();
  }

  private scanName(args: { file: string; report: ReportBuilder }): void {
    const offend = (message: string): void => args.report.offend({ file: args.file, line: 0, rule: RULE, message });
    if (Patterns.ENV_FILE.test(args.file)) offend("an environment file is tracked");
    if (Patterns.CERTIFICATE_FILE.test(args.file)) offend("a certificate or key file is tracked");
  }

  private scanText(args: { file: string; text: string; report: ReportBuilder }): void {
    args.text.split("\n").forEach((line, index) => {
      for (const message of this.problemsIn({ file: args.file, line })) {
        args.report.offend({ file: args.file, line: index + 1, rule: RULE, message });
      }
    });
  }

  private problemsIn(args: { file: string; line: string }): string[] {
    const { line } = args;
    const problems: string[] = [];
    if (Patterns.PRIVATE_KEY.test(line)) problems.push("a private key block");
    for (const token of Patterns.TOKENS) if (token.pattern.test(line)) problems.push(`a token shape: ${token.name}`);
    if (Patterns.ABSOLUTE_PATH.test(line)) problems.push("an absolute home or volume path");
    problems.push(...this.addressProblems(line));
    problems.push(...this.hostProblems(line));
    problems.push(...this.keyPrefixProblems(line));
    problems.push(...this.emailProblemsFor({ file: args.file, line }));
    return problems;
  }

  private addressProblems(line: string): string[] {
    return [...line.matchAll(Patterns.IPV4)]
      .map((m) => m.slice(1, 5).map(Number))
      .filter((octets) => octets.every((o) => o <= MAX_OCTET) && !PrivacyScanner.isPublicDocumentationAddress(octets))
      .map((octets) => `an IPv4 address outside the documentation and loopback ranges: ${octets.join(".")}`);
  }

  private static isPublicDocumentationAddress(octets: number[]): boolean {
    return (
      octets[0] === LOOPBACK_FIRST_OCTET ||
      ALLOWED_NETWORKS.some((network) => network.every((value, index) => octets[index] === value)) ||
      octets.every((o) => o === 0)
    );
  }

  private hostProblems(line: string): string[] {
    const forbidden = new Set(this.options.forbiddenHashes);
    return [...line.toLowerCase().matchAll(Patterns.HOST)]
      .map((m) => m[0])
      .filter((host) => PrivacyScanner.suffixesOf(host).some((suffix) => forbidden.has(Sha256Token.of(suffix))))
      .map(() => "a forbidden host name (matched by hash)");
  }

  private emailProblemsFor(args: { file: string; line: string }): string[] {
    const problems = this.emailProblems(args.line);
    if (!this.options.exemptFromEmailScan.includes(args.file)) return problems;
    if (problems.length > 0) this.exemptionsUsed.add(args.file);
    return [];
  }

  private staleExemptions(): string[] {
    return this.options.exemptFromEmailScan.filter((file) => !this.exemptionsUsed.has(file));
  }

  /** A hashed key prefix matches any token that starts with it. */
  private keyPrefixProblems(line: string): string[] {
    const forbidden = new Set(this.options.forbiddenHashes);
    const found = [...line.matchAll(Patterns.KEY_TOKEN)].some((m) => {
      const token = m[0];
      for (let length = MIN_KEY_PREFIX_LENGTH; length <= token.length; length += 1) {
        if (forbidden.has(Sha256Token.of(token.slice(0, length)))) return true;
      }
      return false;
    });
    return found ? ["a forbidden key prefix (matched by hash)"] : [];
  }

  private emailProblems(line: string): string[] {
    return [...line.matchAll(Patterns.EMAIL)]
      .filter((m) => !this.options.allowedEmailDomains.some((d) => m[0].toLowerCase().endsWith(`@${d}`)))
      .map((m) => `an email address: ${m[0]}`);
  }

  /** `a.b.c` yields `a.b.c`, `b.c` and `c`-less suffixes, so a sub-domain of a forbidden host is caught. */
  private static suffixesOf(host: string): string[] {
    const labels = host.split(".");
    return labels.map((_, index) => labels.slice(index).join(".")).filter((suffix) => suffix.includes("."));
  }
}
