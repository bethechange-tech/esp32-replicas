import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TestCa } from "./test-ca";

const NOW = 1_780_000_000_000;
const HOST = "broker.replica.test";

describe("TestCa", () => {
  const ca = new TestCa({ unixMilliseconds: () => NOW });

  it("is a certificate authority that signs its own certificate", () => {
    const root = new X509Certificate(ca.caPem);
    expect(root.ca).toBe(true);
    expect(root.verify(root.publicKey)).toBe(true);
    expect(root.subject).toContain("Replica Test CA");
  });

  it("issues a certificate for a host that its own certificate verifies, valid on the clock it was given", () => {
    const issued = ca.issue(HOST);
    const leaf = new X509Certificate(issued.certificatePem);
    expect(leaf.ca).toBe(false);
    expect(leaf.checkIssued(new X509Certificate(ca.caPem))).toBe(true);
    expect(leaf.verify(new X509Certificate(ca.caPem).publicKey)).toBe(true);
    expect(leaf.checkHost(HOST)).toBe(HOST);
    expect(leaf.checkHost("other.replica.test")).toBeUndefined();
    expect(new Date(leaf.validFrom).getTime()).toBeLessThan(NOW);
    expect(new Date(leaf.validTo).getTime()).toBeGreaterThan(NOW);
    expect(issued.keyPem).toContain("PRIVATE KEY");
  });

  it("does not verify a certificate under another authority", () => {
    const other = new TestCa({ unixMilliseconds: () => NOW });
    const leaf = new X509Certificate(ca.issue(HOST).certificatePem);
    expect(leaf.verify(new X509Certificate(other.caPem).publicKey)).toBe(false);
  });

  it("makes a new authority every time, so no key is a constant", () => {
    expect(new TestCa({ unixMilliseconds: () => NOW }).caPem).not.toBe(ca.caPem);
  });
});
