const SLIP_END = 0xc0;
const SLIP_ESCAPE = 0xdb;
const SLIP_ESCAPED_END = 0xdc;
const SLIP_ESCAPED_ESCAPE = 0xdd;
const DIRECTION_REQUEST = 0x00;
const COMMAND_SYNC = 0x08;
const COMMAND_MEMORY_BEGIN = 0x05;
const COMMAND_MEMORY_DATA = 0x07;
const CHECKSUM_SEED = 0xef;
const SYNC_PREFIX = [0x07, 0x07, 0x12, 0x20];
const SYNC_FILLER = 0x55;
const SYNC_FILLER_BYTES = 32;
const MEMORY_BLOCK_ADDRESS = 0x3fc90000;
const BYTE_MASK = 0xff;
const BYTE_BITS = 8;

/**
 * Frames of the mask ROM's serial download protocol (the one esptool speaks): SLIP around a request of direction,
 * command, data length, a checksum and the data. MEM_DATA's checksum is the XOR of the data with 0xEF, so the ROM
 * accepts a block only if every byte arrived as sent.
 */
export class RomDownloadFrames {
  /** The ROM's reply header for MEM_DATA: direction 1, command 7, a four-byte body. */
  private static readonly MEMORY_DATA_REPLY = String.fromCharCode(1, COMMAND_MEMORY_DATA, 4);

  /** A success reply: the header, then zeros (a zero status). */
  static isSuccess(console: string): boolean {
    return console.includes(`${RomDownloadFrames.MEMORY_DATA_REPLY}${"\0".repeat(9)}`);
  }

  /** The ROM's answer to a block whose checksum does not match what arrived: status failed (1), invalid CRC (7). */
  static isChecksumFailure(console: string): boolean {
    return console.includes(`${RomDownloadFrames.MEMORY_DATA_REPLY}${"\0".repeat(5)}${String.fromCharCode(1, 7, 0, 0)}`);
  }

  private constructor() {}

  /** The first command: the ROM answers nothing else until it has been synchronised. */
  static sync(): Uint8Array {
    const data = [...SYNC_PREFIX, ...Array<number>(SYNC_FILLER_BYTES).fill(SYNC_FILLER)];
    return RomDownloadFrames.slip(RomDownloadFrames.request({ command: COMMAND_SYNC, checksum: 0, data }));
  }

  static memoryBegin(size: number): Uint8Array {
    return RomDownloadFrames.slip(RomDownloadFrames.request({ command: COMMAND_MEMORY_BEGIN, checksum: 0, data: [size, 1, size, MEMORY_BLOCK_ADDRESS].flatMap(RomDownloadFrames.word) }));
  }

  /** The checksum is of `declared`; `sent` is what goes on the wire, so a block that differs from it is refused. */
  static memoryData(args: { declared: Uint8Array; sent: Uint8Array }): Uint8Array {
    const checksum = args.declared.reduce((sum, byte) => sum ^ byte, CHECKSUM_SEED);
    const data = [args.sent.length, 0, 0, 0].flatMap(RomDownloadFrames.word).concat([...args.sent]);
    return RomDownloadFrames.slip(RomDownloadFrames.request({ command: COMMAND_MEMORY_DATA, checksum, data }));
  }

  private static word(value: number): number[] {
    return [0, 1, 2, 3].map((index) => (value >>> (index * BYTE_BITS)) & BYTE_MASK);
  }

  private static request(args: { command: number; checksum: number; data: readonly number[] }): number[] {
    const { length } = args.data;
    return [DIRECTION_REQUEST, args.command, length & BYTE_MASK, length >> BYTE_BITS, args.checksum & BYTE_MASK, 0, 0, 0, ...args.data];
  }

  private static slip(packet: readonly number[]): Uint8Array {
    const body = packet.flatMap((byte) =>
      byte === SLIP_END ? [SLIP_ESCAPE, SLIP_ESCAPED_END] : byte === SLIP_ESCAPE ? [SLIP_ESCAPE, SLIP_ESCAPED_ESCAPE] : [byte],
    );
    return Uint8Array.from([SLIP_END, ...body, SLIP_END]);
  }
}
