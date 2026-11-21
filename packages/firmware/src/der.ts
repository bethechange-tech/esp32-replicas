/** The few DER (ASN.1) encodings an X.509 certificate needs. */
export class Der {
  static readonly TAG_BOOLEAN = 0x01;
  static readonly TAG_INTEGER = 0x02;
  static readonly TAG_BIT_STRING = 0x03;
  static readonly TAG_OCTET_STRING = 0x04;
  static readonly TAG_NULL = 0x05;
  static readonly TAG_OBJECT_IDENTIFIER = 0x06;
  static readonly TAG_UTF8_STRING = 0x0c;
  static readonly TAG_UTC_TIME = 0x17;
  static readonly TAG_SEQUENCE = 0x30;
  static readonly TAG_SET = 0x31;
  /** Context-specific, constructed, number 0 and 3: the certificate's version and extensions. */
  static readonly TAG_CONTEXT_0 = 0xa0;
  static readonly TAG_CONTEXT_3 = 0xa3;
  /** Context-specific, primitive, number 2: a dNSName in a subjectAltName. */
  static readonly TAG_DNS_NAME = 0x82;

  private static readonly SHORT_FORM_LIMIT = 0x80;
  private static readonly LONG_FORM_FLAG = 0x80;
  private static readonly BYTE_BITS = 8;
  private static readonly BYTE_MASK = 0xff;
  private static readonly HIGH_BIT = 0x80;
  private static readonly OID_FIRST_ARC_FACTOR = 40;
  private static readonly OID_GROUP_BITS = 7;
  private static readonly OID_GROUP_MASK = 0x7f;
  private static readonly OID_CONTINUE = 0x80;

  private constructor() {}

  static element(args: { tag: number; content: Uint8Array }): Uint8Array {
    return Buffer.concat([Buffer.from([args.tag]), Der.length(args.content.length), args.content]);
  }

  static sequence(parts: readonly Uint8Array[]): Uint8Array {
    return Der.element({ tag: Der.TAG_SEQUENCE, content: Buffer.concat(parts) });
  }

  static set(parts: readonly Uint8Array[]): Uint8Array {
    return Der.element({ tag: Der.TAG_SET, content: Buffer.concat(parts) });
  }

  static integer(bytes: Uint8Array): Uint8Array {
    const needsPadding = ((bytes[0] ?? 0) & Der.HIGH_BIT) !== 0;
    const content = needsPadding ? Buffer.concat([Buffer.from([0]), bytes]) : Buffer.from(bytes);
    return Der.element({ tag: Der.TAG_INTEGER, content });
  }

  static boolean(value: boolean): Uint8Array {
    return Der.element({ tag: Der.TAG_BOOLEAN, content: Buffer.from([value ? Der.BYTE_MASK : 0]) });
  }

  static nullValue(): Uint8Array {
    return Der.element({ tag: Der.TAG_NULL, content: Buffer.alloc(0) });
  }

  static octetString(bytes: Uint8Array): Uint8Array {
    return Der.element({ tag: Der.TAG_OCTET_STRING, content: bytes });
  }

  /** A bit string of whole bytes (no unused bits). */
  static bitString(bytes: Uint8Array): Uint8Array {
    return Der.element({ tag: Der.TAG_BIT_STRING, content: Buffer.concat([Buffer.from([0]), bytes]) });
  }

  static utf8(text: string): Uint8Array {
    return Der.element({ tag: Der.TAG_UTF8_STRING, content: Buffer.from(text, "utf8") });
  }

  static dnsName(name: string): Uint8Array {
    return Der.element({ tag: Der.TAG_DNS_NAME, content: Buffer.from(name, "ascii") });
  }

  /** UTCTime, YYMMDDHHMMSSZ; valid for the years 1950 to 2049. */
  static utcTime(unixMilliseconds: number): Uint8Array {
    const iso = new Date(unixMilliseconds).toISOString();
    const digits = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
    return Der.element({ tag: Der.TAG_UTC_TIME, content: Buffer.from(digits, "ascii") });
  }

  /** An object identifier from its arcs. */
  static oid(arcs: readonly number[]): Uint8Array {
    const [first = 0, second = 0, ...rest] = arcs;
    const encoded = [first * Der.OID_FIRST_ARC_FACTOR + second, ...rest].flatMap((arc) => Der.base128(arc));
    return Der.element({ tag: Der.TAG_OBJECT_IDENTIFIER, content: Buffer.from(encoded) });
  }

  private static base128(value: number): number[] {
    const groups = [value & Der.OID_GROUP_MASK];
    for (let rest = Math.floor(value / 2 ** Der.OID_GROUP_BITS); rest > 0; rest = Math.floor(rest / 2 ** Der.OID_GROUP_BITS)) {
      groups.unshift((rest & Der.OID_GROUP_MASK) | Der.OID_CONTINUE);
    }
    return groups;
  }

  private static length(size: number): Buffer {
    if (size < Der.SHORT_FORM_LIMIT) return Buffer.from([size]);
    const bytes: number[] = [];
    for (let rest = size; rest > 0; rest = Math.floor(rest / 2 ** Der.BYTE_BITS)) bytes.unshift(rest & Der.BYTE_MASK);
    return Buffer.from([Der.LONG_FORM_FLAG | bytes.length, ...bytes]);
  }
}
