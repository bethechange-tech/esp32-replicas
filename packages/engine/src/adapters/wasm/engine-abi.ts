import type { GuestModule } from "./guest-module";

const BYTES_PER_MEGABYTE = 1_048_576;

/** The kinds `esp32sim_load` takes (docs/wasm.md upstream). */
export class LoadKind {
  static readonly ROM = 0;
  static readonly BOOTLOADER = 1;
  static readonly PARTITION_TABLE = 2;
  static readonly APP = 3;
  static readonly WHOLE_FLASH = 5;

  private constructor() {}
}

export interface NewHostArgs {
  readonly board: string;
  readonly spec: string;
  readonly flashBytes: number;
  readonly psramBytes: number;
}

/** The only place the engine's C ABI is named: each method is one export, with buffers copied in and out. */
export class EngineAbi {
  constructor(private readonly module: GuestModule) {}

  newHost(args: NewHostArgs): number {
    const board = new TextEncoder().encode(args.board);
    const spec = new TextEncoder().encode(args.spec);
    const boardPointer = this.module.allocate(board);
    const specPointer = this.module.allocate(spec);
    try {
      return this.module.call({
        name: "esp32sim_new_host",
        values: [
          boardPointer,
          board.length,
          Math.ceil(args.flashBytes / BYTES_PER_MEGABYTE),
          Math.ceil(args.psramBytes / BYTES_PER_MEGABYTE),
          specPointer,
          spec.length,
        ],
      });
    } finally {
      this.module.release({ pointer: boardPointer, length: board.length });
      this.module.release({ pointer: specPointer, length: spec.length });
    }
  }

  destroy(emulator: number): void {
    this.module.call({ name: "esp32sim_delete", values: [emulator] });
  }

  load(args: { emulator: number; kind: number; bytes: Uint8Array }): number {
    return this.withBytes({ bytes: args.bytes, use: (pointer) => this.module.call({ name: "esp32sim_load", values: [args.emulator, args.kind, pointer, args.bytes.length] }) });
  }

  loadAt(args: { emulator: number; offset: number; bytes: Uint8Array }): number {
    return this.withBytes({ bytes: args.bytes, use: (pointer) => this.module.call({ name: "esp32sim_load_at", values: [args.emulator, args.offset, pointer, args.bytes.length] }) });
  }

  boot(emulator: number): number {
    return this.module.call({ name: "esp32sim_boot", values: [emulator, 0] });
  }

  run(args: { emulator: number; cycles: number; unixMilliseconds: number }): number {
    return this.module.call({ name: "esp32sim_run", values: [args.emulator, args.cycles, args.unixMilliseconds] });
  }

  cpuHertz(emulator: number): number {
    return this.module.call({ name: "esp32sim_cpu_hz", values: [emulator] });
  }

  /** Drain the outbox: one entry per message, kind 1 text and kind 2 binary. */
  takeOutbox(emulator: number): { kind: number; payload: Uint8Array }[] {
    const count = this.module.call({ name: "esp32sim_out_take", values: [emulator] });
    return Array.from({ length: count }, (_, index) => ({
      kind: this.module.call({ name: "esp32sim_out_kind", values: [emulator, index] }),
      payload: this.module.read({
        pointer: this.module.call({ name: "esp32sim_out_ptr", values: [emulator, index] }),
        length: this.module.call({ name: "esp32sim_out_len", values: [emulator, index] }),
      }),
    }));
  }

  inputText(args: { emulator: number; text: string }): void {
    const bytes = new TextEncoder().encode(args.text);
    this.withBytes({ bytes, use: (pointer) => this.module.call({ name: "esp32sim_in_text", values: [args.emulator, pointer, bytes.length] }) });
  }

  uartInput(args: { emulator: number; pin: number; baud: number; bytes: Uint8Array }): number {
    return this.withBytes({
      bytes: args.bytes,
      use: (pointer) => this.module.call({ name: "esp32sim_board_uart_input", values: [args.emulator, args.pin, args.baud, pointer, args.bytes.length] }),
    });
  }

  private withBytes(args: { bytes: Uint8Array; use: (pointer: number) => number }): number {
    const pointer = this.module.allocate(args.bytes);
    try {
      return args.use(pointer);
    } finally {
      this.module.release({ pointer, length: args.bytes.length });
    }
  }
}
