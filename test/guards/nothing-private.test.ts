import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ForbiddenHashes } from "./support/forbidden-hashes";
import { DirectoryFileSource, GitFileSource, PrivacyScanner } from "./support/privacy-scanner";
import { LockedUpstreamSource } from "./support/locked-upstream-source";
import { Sha256Token } from "./support/sha256-token.ts";
import { VendorLock } from "./support/vendor-lock";
import { RepositoryRoot } from "./support/temp-tree";

/** Addresses are assembled so that this file does not itself hold one. */
function address(...octets: number[]): string {
  return octets.join(".");
}

const COMPANY = ["company", "io"].join(".");
const SECRET_HOST = ["hidden-host", "corp-internal", "test"].join(".");

const SECRET_PREFIX = ["zq9k", "live"].join("-");

const options = {
  forbiddenHashes: [Sha256Token.of(SECRET_HOST), Sha256Token.of(SECRET_PREFIX)],
  allowedEmailDomains: ForbiddenHashes.ALLOWED_EMAIL_DOMAINS,
  exemptFromEmailScan: [],
};

function scanning(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "privacy-fixture-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), content);
    }
    return new PrivacyScanner(new DirectoryFileSource(root), options).scan();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function messages(files: Record<string, string>): string[] {
  return scanning(files).offences.map((o) => o.message);
}

describe("nothing-private", () => {
  it("passes on every tracked and unignored file in the repository", () => {
    const lock = VendorLock.parse(readFileSync(path.join(RepositoryRoot.PATH, "engine.lock"), "utf8"));
    const source = new LockedUpstreamSource(new GitFileSource(RepositoryRoot.PATH), lock);
    const report = new PrivacyScanner(source, {
      forbiddenHashes: ForbiddenHashes.all(RepositoryRoot.PATH),
      allowedEmailDomains: ForbiddenHashes.ALLOWED_EMAIL_DOMAINS,
      exemptFromEmailScan: ForbiddenHashes.EMAIL_EXEMPT_FILES,
    }).scan();
    expect(source.hiddenCount()).toBeGreaterThan(0);
    expect(report.filesRead).toContain("third_party/esp32sim/wasm/src/host_board.rs");
    expect(report.filesRead).toContain("package.json");
    expect(report.filesRead).toContain("test/guards/nothing-private.test.ts");
    expect(report.filesSkipped).toEqual([]);
    expect(report.offences).toEqual([]);
  });

  it("tracks no digest, and keeps only real digests in the local list", () => {
    expect(ForbiddenHashes.LIST).toEqual([]);
    expect(ForbiddenHashes.all(RepositoryRoot.PATH).every((h) => Sha256Token.isDigest(h))).toBe(true);
  });

  describe("vendored upstream files", () => {
    const FIXTURE_EMAIL = ["someone", "example-private.invalid"].join("@");
    const upstreamText = `an email: ${FIXTURE_EMAIL}\n`;
    const lockFor = (text: string) => ({
      upstream: { repository: "x", commit: "y", license: "MIT" },
      toolchain: { rust: "1", target: "t" },
      files: { "a.rs": VendorLock.digestOf(Buffer.from(text)) },
      seam: { modified: {}, added: {} },
    });
    const scratch = (text: string): string => {
      const root = mkdtempSync(path.join(tmpdir(), "locked-upstream-"));
      mkdirSync(path.join(root, "third_party/esp32sim"), { recursive: true });
      writeFileSync(path.join(root, "third_party/esp32sim/a.rs"), text);
      return root;
    };

    it("hides a file that equals upstream's by the lock, and so does not read it", () => {
      const root = scratch(upstreamText);
      try {
        const source = new LockedUpstreamSource(new DirectoryFileSource(root), lockFor(upstreamText));
        expect(source.list()).toEqual([]);
        expect(source.hiddenCount()).toBe(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("still reads a vendored file that differs from the lock, and reports what is in it", () => {
      const root = scratch(`${upstreamText}changed\n`);
      try {
        const source = new LockedUpstreamSource(new DirectoryFileSource(root), lockFor(upstreamText));
        expect(source.list()).toEqual(["third_party/esp32sim/a.rs"]);
        const report = new PrivacyScanner(source, options).scan();
        expect(report.filesRead).toEqual(["third_party/esp32sim/a.rs"]);
        expect(report.offences.map((o) => o.message)).toEqual([`an email address: ${FIXTURE_EMAIL}`]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  it("reads an untracked local hash list when one is present, and only real digests from it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "local-hashes-"));
    try {
      expect(ForbiddenHashes.all(root)).toEqual([...ForbiddenHashes.LIST]);
      const digest = Sha256Token.of(SECRET_HOST);
      writeFileSync(path.join(root, ".private-hashes"), `${digest}\nnot a digest\n`);
      expect(ForbiddenHashes.all(root)).toEqual([...ForbiddenHashes.LIST, digest]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe("breaks-on", () => {
    it("a clean file is read and accepted (the control)", () => {
      const report = scanning({ "a.md": `Wi-Fi at ${address(10, 0, 2, 15)}, broker at ${address(203, 0, 113, 5)}, loopback ${address(127, 0, 0, 1)}, see https://example.org` });
      expect(report.filesRead).toEqual(["a.md"]);
      expect(report.offences).toEqual([]);
    });

    it("a private key block", () => {
      const block = ["-----BEGIN", " RSA ", "PRIVATE KEY-----"].join("");
      expect(messages({ "k.txt": block })).toEqual(["a private key block"]);
    });

    it("a tracked environment file, and a certificate file", () => {
      expect(messages({ ".env": "A=1" })).toEqual(["an environment file is tracked"]);
      expect(messages({ ".env.local": "A=1" })).toEqual(["an environment file is tracked"]);
      expect(messages({ "sub/ca.pem": "x" })).toEqual(["a certificate or key file is tracked"]);
    });

    it("token shapes", () => {
      const github = ["gh", "p_", "a".repeat(36)].join("");
      const npm = ["np", "m_", "b".repeat(36)].join("");
      const aws = ["AK", "IA", "A".repeat(16)].join("");
      expect(messages({ "t.txt": `${github}\n${npm}\n${aws}` })).toEqual(["a token shape: github token", "a token shape: npm token", "a token shape: aws access key"]);
    });

    it("an absolute home or volume path", () => {
      for (const prefix of ["/Us" + "ers/", "/ho" + "me/", "/Vol" + "umes/"]) {
        expect(messages({ "p.txt": `see ${prefix}someone/project` })).toEqual(["an absolute home or volume path"]);
      }
    });

    it("an IPv4 address outside the documentation and loopback ranges, but not inside", () => {
      const public4 = address(8, 8, 4, 4);
      const private4 = address(192, 168, 1, 20);
      expect(messages({ "i.txt": `host ${public4}` })[0]).toContain(public4);
      expect(messages({ "i.txt": `host ${private4}` })[0]).toContain(private4);
      const allowed = [address(192, 0, 2, 1), address(198, 51, 100, 7), address(203, 0, 113, 9), address(10, 0, 2, 15), address(127, 1, 2, 3)];
      expect(messages({ "i.txt": allowed.join(" ") })).toEqual([]);
    });

    it("a hashed host, and a sub-domain of one", () => {
      expect(messages({ "h.txt": `broker ${SECRET_HOST}` })).toEqual(["a forbidden host name (matched by hash)"]);
      expect(messages({ "h.txt": `broker mqtt.${SECRET_HOST}:8883` })).toEqual(["a forbidden host name (matched by hash)"]);
      expect(messages({ "h.txt": "broker.replica.test" })).toEqual([]);
    });

    it("a hashed key prefix matches any token that starts with it, and a shorter or different token does not", () => {
      expect(messages({ "k.txt": `token ${SECRET_PREFIX}-abc123def` })).toEqual(["a forbidden key prefix (matched by hash)"]);
      expect(messages({ "k.txt": `KEY=${SECRET_PREFIX}` })).toEqual(["a forbidden key prefix (matched by hash)"]);
      expect(messages({ "k.txt": "token zq9k-other-abc123def zq9" })).toEqual([]);
    });

    it("a binary or oversized file is reported as skipped, never as read", () => {
      const report = scanning({ "b.bin": "ab\0cd", "big.txt": "x".repeat(2_000_001), "ok.txt": "fine" });
      expect(report.filesRead).toEqual(["ok.txt"]);
      expect(report.filesSkipped).toEqual(["b.bin", "big.txt"]);
    });

    it("an email address, unless its domain is for documentation", () => {
      expect(messages({ "e.txt": `write to someone@${COMPANY}` })).toEqual([`an email address: someone@${COMPANY}`]);
      expect(messages({ "e.txt": "someone@example.org" })).toEqual([]);
    });

    it("an email-scan exemption is by exact path only", () => {
      const root = mkdtempSync(path.join(tmpdir(), "privacy-fixture-"));
      try {
        writeFileSync(path.join(root, "pnpm-lock.yaml"), `x@${COMPANY}`);
        writeFileSync(path.join(root, "other.txt"), `x@${COMPANY}`);
        const report = new PrivacyScanner(new DirectoryFileSource(root), { ...options, exemptFromEmailScan: ["pnpm-lock.yaml"] }).scan();
        expect(report.offences.map((o) => o.file)).toEqual(["other.txt"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("an email exemption that exempts nothing is an offence", () => {
      const root = mkdtempSync(path.join(tmpdir(), "privacy-fixture-"));
      try {
        writeFileSync(path.join(root, "clean.txt"), "nothing here");
        const report = new PrivacyScanner(new DirectoryFileSource(root), { ...options, exemptFromEmailScan: ["clean.txt", "gone.txt"] }).scan();
        expect(report.offences.map((o) => `${o.file}: ${o.message}`)).toEqual([
          "clean.txt: email exemption matches nothing",
          "gone.txt: email exemption matches nothing",
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
