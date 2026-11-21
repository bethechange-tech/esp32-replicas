import {
  EngineNotCreated,
  type BoardDeclaration,
  type EmulatorEngine,
  type EngineInput,
  type FlashImage,
  type Observation,
  type RomSource,
  type Slice,
} from "@replicas/core";
import type { EngineAbi } from "./engine-abi";
import { LoadKind } from "./engine-abi";
import type { GuestModule } from "./guest-module";
import type { HostBoardBridge } from "./host-board-bridge";
import type { HostImports } from "./host-imports";
import { Outbox, type ConsoleSource } from "./outbox";

const HOST_BOARD_FOR_CHIP = { esp32s3: "host", esp32: "host-esp32" } as const;
const MAX_CONSOLE_BYTES_PER_MESSAGE = 32_768;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

export class EngineRefused extends Error {
  constructor(what: string) {
    super(`the engine refused ${what}`);
  }
}

export class EngineStopped extends Error {
  constructor(readonly code: number) {
    super(`the engine stopped with code ${code}`);
  }
}

export class UnsupportedInput extends Error {
  constructor(kind: string) {
    super(`console, gpio and strap input are supported; ${kind} input is not yet`);
  }
}

export interface WasmEmulatorEngineParts {
  /** The compiled module's bytes: `build/esp32sim.wasm`, from `tools/build-engine.sh`. */
  readonly wasm: Uint8Array;
  readonly roms: RomSource;
  readonly guest: GuestModule;
  readonly abi: EngineAbi;
  readonly bridge: HostBoardBridge;
  readonly imports: HostImports;
  readonly console: ConsoleSource;
}

/** Runs unchanged firmware images in the engine's module, through its host board. The one place the module is instantiated. */
export class WasmEmulatorEngine implements EmulatorEngine {
  private emulator: number | undefined;
  private chip: BoardDeclaration["chip"] | undefined;
  private pendingConsole = "";

  constructor(private readonly parts: WasmEmulatorEngineParts) {}

  async create(declaration: BoardDeclaration): Promise<void> {
    this.destroy();
    const { instance } = await WebAssembly.instantiate(this.parts.wasm, this.parts.imports.build());
    this.parts.guest.bind(instance.exports);
    this.parts.bridge.attach(declaration);
    const emulator = this.parts.abi.newHost({
      board: HOST_BOARD_FOR_CHIP[declaration.chip],
      spec: WasmEmulatorEngine.specOf(declaration),
      flashBytes: declaration.flashBytes,
      psramBytes: declaration.psramBytes,
    });
    if (emulator === 0) throw new EngineRefused("the board declaration");
    this.emulator = emulator;
    this.chip = declaration.chip;
    this.requireOk({ code: this.parts.abi.load({ emulator, kind: LoadKind.ROM, bytes: this.parts.roms.rom(declaration.chip) }), what: "the mask ROM" });
  }

  destroy(): void {
    if (this.emulator === undefined) return;
    this.parts.abi.destroy(this.emulator);
    this.emulator = undefined;
    this.chip = undefined;
    this.pendingConsole = "";
  }

  load(image: FlashImage): void {
    const emulator = this.created();
    const code =
      image.offset === 0
        ? this.parts.abi.load({ emulator, kind: LoadKind.WHOLE_FLASH, bytes: image.bytes })
        : this.parts.abi.loadAt({ emulator, offset: image.offset, bytes: image.bytes });
    this.requireOk({ code, what: `the flash image at ${image.offset}` });
  }

  boot(): void {
    this.requireOk({ code: this.parts.abi.boot(this.created()), what: "the boot" });
  }

  run(slice: Slice): void {
    const emulator = this.created();
    const code = this.parts.abi.run({ emulator, cycles: slice.cycles, unixMilliseconds: slice.unixMilliseconds });
    this.drain(emulator);
    if (code !== 0) throw new EngineStopped(code);
  }

  sendInput(input: EngineInput): void {
    const emulator = this.created();
    if (input.kind === "console") {
      this.sendConsole({ emulator, bytes: input.bytes });
      return;
    }
    if (input.kind === "gpio") {
      this.parts.abi.inputText({ emulator, text: JSON.stringify({ t: "btn", pin: input.gpio, v: input.level ? "0" : "1" }) });
      return;
    }
    if (input.kind === "strap") {
      this.parts.abi.inputText({ emulator, text: JSON.stringify({ t: "strap", v: `0x${input.value.toString(HEX_RADIX)}` }) });
      return;
    }
    throw new UnsupportedInput(input.kind);
  }

  takeOutput(): Observation {
    this.drain(this.created());
    const { gpioEdges, frames } = this.parts.bridge.takeObservations();
    const console = this.pendingConsole;
    this.pendingConsole = "";
    return { console, frames, gpioEdges };
  }

  /** The emulated CPU clock in hertz, so a caller turns seconds into the cycles of a `Slice`. */
  cpuHertz(): number {
    return this.parts.abi.cpuHertz(this.created());
  }

  chipFamily(): BoardDeclaration["chip"] {
    if (!this.chip) throw new EngineNotCreated();
    return this.chip;
  }

  /** `{"t":"bytes"}` carries hex, so every byte value 0x00 to 0xFF reaches the guest unchanged. */
  private sendConsole(args: { emulator: number; bytes: Uint8Array }): void {
    for (let start = 0; start < args.bytes.length; start += MAX_CONSOLE_BYTES_PER_MESSAGE) {
      const chunk = args.bytes.slice(start, start + MAX_CONSOLE_BYTES_PER_MESSAGE);
      const hex = Array.from(chunk, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
      this.parts.abi.inputText({ emulator: args.emulator, text: JSON.stringify({ t: "bytes", hex, src: this.parts.console }) });
    }
  }

  private drain(emulator: number): void {
    const messages = this.parts.abi.takeOutbox(emulator);
    this.pendingConsole += Outbox.consoleText({ messages, source: this.parts.console });
  }

  private created(): number {
    if (this.emulator === undefined) throw new EngineNotCreated();
    return this.emulator;
  }

  private requireOk(args: { code: number; what: string }): void {
    if (args.code !== 0) throw new EngineRefused(args.what);
  }

  private static specOf(declaration: BoardDeclaration): string {
    const i2c = declaration.i2cAddresses.map((entry) => `${entry.bus}:${entry.address}`).join(",");
    const flag = (value: boolean): string => (value ? "1" : "0");
    return `i2c=${i2c};spi=${flag(declaration.routesSpiToHost)};uart=${flag(declaration.routesUartToHost)};lcd=${flag(declaration.routesLcdToHost)}`;
  }
}
