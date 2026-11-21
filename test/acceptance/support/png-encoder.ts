import { deflateSync } from "node:zlib";
import type { LcdFrame } from "@replicas/core";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOUR_TYPE_RGB = 2;
const BIT_DEPTH = 8;
const FILTER_NONE = 0;
const RED_SHIFT = 11;
const GREEN_SHIFT = 5;
const FIVE_BITS = 0x1f;
const SIX_BITS = 0x3f;
const FIVE_BIT_SPREAD = 2;
const SIX_BIT_SPREAD = 4;
const FIVE_BIT_LEFT = 3;
const SIX_BIT_LEFT = 2;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
const CRC_POLYNOMIAL = 0xedb88320;
const CRC_ROUNDS = 8;
const TABLE_SIZE = 256;
const COMPRESSION_LEVEL = 9;
const HEADER_BYTES = 13;
const WORD_BYTES = 4;

/** Writes a frame as a PNG a reviewer can open. Same frame, same bytes: no time, no metadata, fixed compression. */
export class PngEncoder {
  private static table: Uint32Array | undefined;

  private constructor() {}

  static encode(frame: LcdFrame): Uint8Array {
    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt32BE(frame.width, 0);
    header.writeUInt32BE(frame.height, WORD_BYTES);
    header[WORD_BYTES * 2] = BIT_DEPTH;
    header[WORD_BYTES * 2 + 1] = COLOUR_TYPE_RGB;
    const parts = [SIGNATURE, PngEncoder.chunk({ type: "IHDR", data: header }), PngEncoder.chunk({ type: "IDAT", data: deflateSync(PngEncoder.scanlines(frame), { level: COMPRESSION_LEVEL }) }), PngEncoder.chunk({ type: "IEND", data: new Uint8Array(0) })];
    return Buffer.concat(parts);
  }

  private static scanlines(frame: LcdFrame): Buffer {
    const rowBytes = frame.width * 3;
    const out = Buffer.alloc((rowBytes + 1) * frame.height);
    for (let y = 0; y < frame.height; y += 1) {
      const rowStart = y * (rowBytes + 1);
      out[rowStart] = FILTER_NONE;
      for (let x = 0; x < frame.width; x += 1) {
        const at = (y * frame.width + x) * 2;
        const value = ((frame.rgb565[at] ?? 0) << BYTE_BITS) | (frame.rgb565[at + 1] ?? 0);
        const r = (value >> RED_SHIFT) & FIVE_BITS;
        const g = (value >> GREEN_SHIFT) & SIX_BITS;
        const b = value & FIVE_BITS;
        out[rowStart + 1 + x * 3] = (r << FIVE_BIT_LEFT) | (r >> FIVE_BIT_SPREAD);
        out[rowStart + 2 + x * 3] = (g << SIX_BIT_LEFT) | (g >> SIX_BIT_SPREAD);
        out[rowStart + 3 + x * 3] = (b << FIVE_BIT_LEFT) | (b >> FIVE_BIT_SPREAD);
      }
    }
    return out;
  }

  private static chunk(args: { type: string; data: Uint8Array }): Buffer {
    const body = Buffer.concat([Buffer.from(args.type, "ascii"), args.data]);
    const out = Buffer.alloc(body.length + WORD_BYTES * 2);
    out.writeUInt32BE(args.data.length, 0);
    body.copy(out, WORD_BYTES);
    out.writeUInt32BE(PngEncoder.crc(body), body.length + WORD_BYTES);
    return out;
  }

  private static crc(bytes: Uint8Array): number {
    const table = (PngEncoder.table ??= PngEncoder.buildTable());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (table[(crc ^ byte) & BYTE_MASK] ?? 0) ^ (crc >>> BYTE_BITS);
    return (crc ^ 0xffffffff) >>> 0;
  }

  private static buildTable(): Uint32Array {
    return Uint32Array.from({ length: TABLE_SIZE }, (_, index) => {
      let value = index;
      for (let round = 0; round < CRC_ROUNDS; round += 1) value = value & 1 ? CRC_POLYNOMIAL ^ (value >>> 1) : value >>> 1;
      return value >>> 0;
    });
  }
}
