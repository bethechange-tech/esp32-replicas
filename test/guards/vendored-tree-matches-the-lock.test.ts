import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { GitAttributes } from "./support/git-attributes";
import { GitFileSource } from "./support/privacy-scanner";
import { RepositoryRoot } from "./support/temp-tree";
import { type EngineLockData, VendorLock } from "./support/vendor-lock";

const VENDORED = "third_party/esp32sim";
const LOCK_FILE = "engine.lock";
const PINNED_COMMIT = "d043ff1dd3e53aca18a23f4f2b18bfb038a57667";
const PINNED_RUST = "1.100.0";

function lockOf(files: Readonly<Record<string, string>>, seam?: EngineLockData["seam"]): EngineLockData {
  return {
    upstream: { repository: "https://example.org/up", commit: "abc", license: "MIT" },
    toolchain: { rust: PINNED_RUST, target: "wasm32-unknown-unknown" },
    files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, VendorLock.digestOf(Buffer.from(text))])),
    seam: seam ?? { modified: {}, added: {} },
  };
}

function scratch(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "vendored-fixture-"));
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

describe("vendored-tree-matches-the-lock", () => {
  const lock = VendorLock.parse(readFileSync(path.join(RepositoryRoot.PATH, LOCK_FILE), "utf8"));

  it("the lock names the pinned upstream commit and the pinned toolchain", () => {
    expect(lock.upstream.commit).toBe(PINNED_COMMIT);
    expect(lock.toolchain.rust).toBe(PINNED_RUST);
    expect(Object.keys(lock.files).length).toBeGreaterThan(0);
  });

  it("every vendored file git would publish (tracked, or untracked and not ignored) is upstream's, or a file the seam lists with its sealed content", () => {
    const prefix = `${VENDORED}/`;
    const published = new GitFileSource(RepositoryRoot.PATH).list().filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
    expect(published.length).toBeGreaterThan(0);
    const differences = VendorLock.differences({ root: path.join(RepositoryRoot.PATH, VENDORED), lock, files: published });
    expect(differences).toEqual([]);
  });

  it("git stores every vendored file byte for byte: none is converted by an attribute (line endings would break the lock)", () => {
    const files = new GitFileSource(RepositoryRoot.PATH).list().filter((file) => file.startsWith(`${VENDORED}/`));
    expect(files.length).toBeGreaterThan(0);
    expect(GitAttributes.converted({ root: RepositoryRoot.PATH, files })).toEqual([]);
  });

  it("the seam lists only files that make sense: modified ones are upstream's, added ones are not", () => {
    expect(VendorLock.malformedSeam(lock)).toEqual([]);
  });

  it("keeps upstream's licence files byte for byte, outside the seam", () => {
    for (const file of ["LICENSE", "esp-periph/LICENSE-ADC"]) {
      expect(lock.files[file], file).toBeDefined();
      expect(lock.seam.modified[file], file).toBeUndefined();
    }
  });

  describe("breaks-on", () => {
    it("a file that a text attribute would convert is reported, and one marked -text is not", () => {
      const root = scratch({ "a.txt": "one\r\n", "b.txt": "two\r\n", ".gitattributes": "* text=auto eol=lf\nb.txt -text\n" });
      try {
        execFileSync("git", ["init", "-q"], { cwd: root });
        expect(GitAttributes.converted({ root, files: ["a.txt", "b.txt"] })).toEqual(["a.txt"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("a clean tree passes, and the control reads the files it is meant to (the control)", () => {
      const root = scratch({ "a.rs": "one", "b/c.rs": "two" });
      try {
        expect(VendorLock.filesUnder(root)).toEqual(["a.rs", "b/c.rs"]);
        expect(VendorLock.differences({ root, lock: lockOf({ "a.rs": "one", "b/c.rs": "two" }) })).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("only the files it is given are read, so an ignored file in the directory is not a difference", () => {
      const root = scratch({ "a.rs": "one", ".DS_Store": "junk" });
      try {
        expect(VendorLock.differences({ root, lock: lockOf({ "a.rs": "one" }), files: ["a.rs"] })).toEqual([]);
        expect(VendorLock.differences({ root, lock: lockOf({ "a.rs": "one" }) })).toEqual([{ path: ".DS_Store", problem: "is in the tree and not in the lock" }]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("an upstream file edited outside the seam is reported by name", () => {
      const root = scratch({ "a.rs": "edited" });
      try {
        expect(VendorLock.differences({ root, lock: lockOf({ "a.rs": "one" }) })).toEqual([{ path: "a.rs", problem: "differs from upstream" }]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("a file added outside the seam, and a file removed, are both reported", () => {
      const root = scratch({ "extra.rs": "x" });
      try {
        expect(VendorLock.differences({ root, lock: lockOf({ "a.rs": "one" }) })).toEqual([
          { path: "a.rs", problem: "is in the lock and missing from the tree" },
          { path: "extra.rs", problem: "is in the tree and not in the lock" },
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("a seam file changed after it was sealed is reported, and a sealed change passes", () => {
      const sealed = VendorLock.digestOf(Buffer.from("seam v1"));
      const seam = { modified: { "a.rs": sealed }, added: {} };
      const base = lockOf({ "a.rs": "one" }, seam);
      const changed = scratch({ "a.rs": "seam v2" });
      const intact = scratch({ "a.rs": "seam v1" });
      try {
        expect(VendorLock.differences({ root: changed, lock: base })).toEqual([
          { path: "a.rs", problem: "differs from its sealed seam content" },
        ]);
        expect(VendorLock.differences({ root: intact, lock: base })).toEqual([]);
      } finally {
        rmSync(changed, { recursive: true, force: true });
        rmSync(intact, { recursive: true, force: true });
      }
    });

    it("a seam entry that does not match the upstream list is reported", () => {
      const lockWithBadSeam = lockOf(
        { "a.rs": "one" },
        { modified: { "ghost.rs": "0" }, added: { "a.rs": "0" } },
      );
      expect(VendorLock.malformedSeam(lockWithBadSeam)).toEqual([
        "ghost.rs is listed as modified and is not an upstream file",
        "a.rs is listed as added and is an upstream file",
      ]);
    });
  });
});
