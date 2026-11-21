import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { CertificateAuthority, Clock } from "@replicas/core";
import { Der } from "./der";

const RSA_BITS = 2048;
const SERIAL_BYTES = 16;
const DAY_MILLISECONDS = 86_400_000;
const VALID_DAYS = 365;
const BACKDATE_DAYS = 1;
const CA_NAME = "Replica Test CA";
const PEM_LINE = 64;
/** X.509 version 3 is encoded as 2. */
const X509_VERSION_3 = 2;
const POSITIVE_INTEGER_MASK = 0x7f;

/** Object identifiers as their arcs (so none reads as an IP address), from RFC 5280 and RFC 8017 (sha256WithRSAEncryption). */
class Oids {
  static readonly SHA256_WITH_RSA: readonly number[] = [1, 2, 840, 113549, 1, 1, 11];
  static readonly COMMON_NAME: readonly number[] = [2, 5, 4, 3];
  static readonly BASIC_CONSTRAINTS: readonly number[] = [2, 5, 29, 19];
  static readonly KEY_USAGE: readonly number[] = [2, 5, 29, 15];
  static readonly EXTENDED_KEY_USAGE: readonly number[] = [2, 5, 29, 37];
  static readonly SUBJECT_ALT_NAME: readonly number[] = [2, 5, 29, 17];
  static readonly SERVER_AUTH: readonly number[] = [1, 3, 6, 1, 5, 5, 7, 3, 1];

  private constructor() {}
}

/** keyUsage bit strings: keyCertSign and cRLSign for the CA; digitalSignature and keyEncipherment for a leaf. */
class KeyUsages {
  static readonly CA = Buffer.from([0x03, 0x02, 0x01, 0x06]);
  static readonly LEAF = Buffer.from([0x03, 0x02, 0x05, 0xa0]);

  private constructor() {}
}

interface SubjectKey {
  readonly name: string;
  readonly publicKey: KeyObject;
}

/** A fresh certificate authority per run, in memory: its key is never written anywhere, so no key is ever committed. */
export class TestCa implements CertificateAuthority {
  readonly caPem: string;
  private readonly caKey: KeyObject;
  private readonly caName: string = CA_NAME;

  constructor(private readonly clock: Clock) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: RSA_BITS });
    this.caKey = privateKey;
    this.caPem = TestCa.pem({ label: "CERTIFICATE", der: this.certificate({ subject: { name: this.caName, publicKey }, authority: true, hostName: undefined }) });
  }

  issue(hostName: string): { readonly certificatePem: string; readonly keyPem: string } {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: RSA_BITS });
    const der = this.certificate({ subject: { name: hostName, publicKey }, authority: false, hostName });
    return {
      certificatePem: TestCa.pem({ label: "CERTIFICATE", der }),
      keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
  }

  private certificate(args: { subject: SubjectKey; authority: boolean; hostName: string | undefined }): Uint8Array {
    const signatureAlgorithm = Der.sequence([Der.oid(Oids.SHA256_WITH_RSA), Der.nullValue()]);
    const tbs = this.toBeSigned({ ...args, signatureAlgorithm });
    const signature = sign("sha256", tbs, this.caKey);
    return Der.sequence([tbs, signatureAlgorithm, Der.bitString(signature)]);
  }

  private toBeSigned(args: { subject: SubjectKey; authority: boolean; hostName: string | undefined; signatureAlgorithm: Uint8Array }): Uint8Array {
    const now = this.clock.unixMilliseconds();
    const serial = randomBytes(SERIAL_BYTES);
    serial[0] = (serial[0] ?? 0) & POSITIVE_INTEGER_MASK;
    return Der.sequence([
      Der.element({ tag: Der.TAG_CONTEXT_0, content: Der.integer(Buffer.from([X509_VERSION_3])) }),
      Der.integer(serial),
      args.signatureAlgorithm,
      TestCa.name(this.caName),
      Der.sequence([Der.utcTime(now - BACKDATE_DAYS * DAY_MILLISECONDS), Der.utcTime(now + VALID_DAYS * DAY_MILLISECONDS)]),
      TestCa.name(args.subject.name),
      Buffer.from(args.subject.publicKey.export({ type: "spki", format: "der" })),
      Der.element({ tag: Der.TAG_CONTEXT_3, content: Der.sequence(TestCa.extensions(args)) }),
    ]);
  }

  private static extensions(args: { authority: boolean; hostName: string | undefined }): Uint8Array[] {
    const basic = TestCa.extension({
      oid: Oids.BASIC_CONSTRAINTS,
      critical: true,
      value: Der.sequence(args.authority ? [Der.boolean(true)] : []),
    });
    const usage = TestCa.extension({ oid: Oids.KEY_USAGE, critical: true, value: args.authority ? KeyUsages.CA : KeyUsages.LEAF });
    if (args.authority || args.hostName === undefined) return [basic, usage];
    return [
      basic,
      usage,
      TestCa.extension({ oid: Oids.EXTENDED_KEY_USAGE, critical: false, value: Der.sequence([Der.oid(Oids.SERVER_AUTH)]) }),
      TestCa.extension({ oid: Oids.SUBJECT_ALT_NAME, critical: false, value: Der.sequence([Der.dnsName(args.hostName)]) }),
    ];
  }

  private static extension(args: { oid: readonly number[]; critical: boolean; value: Uint8Array }): Uint8Array {
    const parts = [Der.oid(args.oid), ...(args.critical ? [Der.boolean(true)] : []), Der.octetString(args.value)];
    return Der.sequence(parts);
  }

  private static name(commonName: string): Uint8Array {
    return Der.sequence([Der.set([Der.sequence([Der.oid(Oids.COMMON_NAME), Der.utf8(commonName)])])]);
  }

  private static pem(args: { label: string; der: Uint8Array }): string {
    const body = Buffer.from(args.der).toString("base64").match(new RegExp(`.{1,${PEM_LINE}}`, "g"))?.join("\n") ?? "";
    return `-----BEGIN ${args.label}-----\n${body}\n-----END ${args.label}-----\n`;
  }
}
