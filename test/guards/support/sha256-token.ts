import { createHash } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export class Sha256Token {
  private constructor() {}

  static of(token: string): string {
    return createHash("sha256").update(token.toLowerCase()).digest("hex");
  }

  static isDigest(value: string): boolean {
    return HEX_SHA256.test(value);
  }
}
