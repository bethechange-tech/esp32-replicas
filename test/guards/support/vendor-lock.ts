import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const UPSTREAM_REPOSITORY = "https://github.com/mikroverk/esp32sim";
const UPSTREAM_LICENSE = "MIT";
const RUST_TOOLCHAIN = "1.100.0";
const RUST_TARGET = "wasm32-unknown-unknown";
const JSON_INDENT = 2;

export interface EngineLockData {
  readonly upstream: { readonly repository: string; readonly commit: string; readonly license: string };
  readonly toolchain: { readonly rust: string; readonly target: string };
  /** SHA-256 of every vendored file as upstream has it at `upstream.commit`. */
  readonly files: Readonly<Record<string, string>>;
  readonly seam: {
    /** Upstream files the seam changes, with the SHA-256 the changed file must have. */
    readonly modified: Readonly<Record<string, string>>;
    /** Files the seam adds, with their SHA-256. */
    readonly added: Readonly<Record<string, string>>;
  };
}

export interface LockDifference {
  readonly path: string;
  readonly problem: string;
}

/** engine.lock: which vendored files are upstream's, byte for byte, and which belong to the seam. */
export class VendorLock {
  private constructor() {}

  static digestOf(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
  }

  static filesUnder(root: string): string[] {
    return VendorLock.walk({ root, relative: "" }).sort();
  }

  static digests(root: string): Record<string, string> {
    return Object.fromEntries(
      VendorLock.filesUnder(root).map((file) => [file, VendorLock.digestOf(readFileSync(path.join(root, file)))]),
    );
  }

  static parse(text: string): EngineLockData {
    return JSON.parse(text) as EngineLockData;
  }

  /** Differences between a tree and its lock; empty when the tree is the lock. `files` limits the tree to those paths (what git would publish). */
  static differences(args: { root: string; lock: EngineLockData; files?: readonly string[] }): LockDifference[] {
    const actual = args.files
      ? Object.fromEntries(args.files.map((file) => [file, VendorLock.digestOf(readFileSync(path.join(args.root, file)))]))
      : VendorLock.digests(args.root);
    const { files, seam } = args.lock;
    const expected = new Map<string, { digest: string; why: string }>();
    for (const [file, digest] of Object.entries(files)) expected.set(file, { digest, why: "differs from upstream" });
    for (const [file, digest] of Object.entries(seam.modified)) expected.set(file, { digest, why: "differs from its sealed seam content" });
    for (const [file, digest] of Object.entries(seam.added)) expected.set(file, { digest, why: "differs from its sealed seam content" });
    const found: LockDifference[] = [];
    for (const [file, { digest, why }] of expected) {
      if (actual[file] === undefined) found.push({ path: file, problem: "is in the lock and missing from the tree" });
      else if (actual[file] !== digest) found.push({ path: file, problem: why });
    }
    for (const file of Object.keys(actual)) {
      if (!expected.has(file)) found.push({ path: file, problem: "is in the tree and not in the lock" });
    }
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Seam entries that name no file, or name a file the other list also names. */
  static malformedSeam(lock: EngineLockData): string[] {
    const problems: string[] = [];
    for (const file of Object.keys(lock.seam.modified)) {
      if (lock.files[file] === undefined) problems.push(`${file} is listed as modified and is not an upstream file`);
    }
    for (const file of Object.keys(lock.seam.added)) {
      if (lock.files[file] !== undefined) problems.push(`${file} is listed as added and is an upstream file`);
    }
    return problems;
  }

  static write(args: { pristine: string; lockFile: string; commit: string }): void {
    const previous = VendorLock.readIfPresent(args.lockFile);
    const data: EngineLockData = {
      upstream: { repository: UPSTREAM_REPOSITORY, commit: args.commit, license: UPSTREAM_LICENSE },
      toolchain: { rust: RUST_TOOLCHAIN, target: RUST_TARGET },
      files: VendorLock.digests(args.pristine),
      seam: previous?.seam ?? { modified: {}, added: {} },
    };
    writeFileSync(args.lockFile, `${JSON.stringify(data, null, JSON_INDENT)}\n`);
  }

  /** Record the current content of the named seam files; run after the seam is applied or changed. */
  static seal(args: { root: string; lockFile: string; modified: readonly string[]; added: readonly string[] }): void {
    const lock = VendorLock.parse(readFileSync(args.lockFile, "utf8"));
    const digest = (file: string): string => VendorLock.digestOf(readFileSync(path.join(args.root, file)));
    const sealed: EngineLockData = {
      ...lock,
      seam: {
        modified: Object.fromEntries([...args.modified].sort().map((file) => [file, digest(file)])),
        added: Object.fromEntries([...args.added].sort().map((file) => [file, digest(file)])),
      },
    };
    writeFileSync(args.lockFile, `${JSON.stringify(sealed, null, JSON_INDENT)}\n`);
  }

  private static readIfPresent(lockFile: string): EngineLockData | undefined {
    try {
      return VendorLock.parse(readFileSync(lockFile, "utf8"));
    } catch {
      return undefined;
    }
  }

  private static walk(args: { root: string; relative: string }): string[] {
    const directory = path.join(args.root, args.relative);
    return readdirSync(directory).flatMap((entry) => {
      const next = args.relative === "" ? entry : `${args.relative}/${entry}`;
      return statSync(path.join(args.root, next)).isDirectory() ? VendorLock.walk({ root: args.root, relative: next }) : [next];
    });
  }
}

class VendorLockCommand {
  private constructor() {}

  static run(argv: readonly string[]): void {
    const [command, ...rest] = argv;
    if (command === "write" && rest.length === 3) {
      VendorLock.write({ pristine: rest[0] ?? "", lockFile: rest[1] ?? "", commit: rest[2] ?? "" });
      return;
    }
    if (command === "seal" && rest.length === 4) {
      VendorLock.seal({ root: rest[0] ?? "", lockFile: rest[1] ?? "", modified: VendorLockCommand.list(rest[2]), added: VendorLockCommand.list(rest[3]) });
      return;
    }
    process.stderr.write("usage: vendor-lock.ts write <pristine> <lock> <commit> | seal <root> <lock> <modified,...> <added,...>\n");
    process.exitCode = 1;
  }

  private static list(value: string | undefined): string[] {
    return (value ?? "").split(",").filter((entry) => entry !== "");
  }
}

if (process.argv[1]?.endsWith("vendor-lock.ts")) VendorLockCommand.run(process.argv.slice(2));
