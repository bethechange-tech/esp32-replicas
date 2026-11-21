import {
  EngineNotCreated,
  type BoardDeclaration,
  type EmulatorEngine,
  type EngineInput,
  type FlashImage,
  type FlowAnswer,
  type FlowRequest,
  type GuestRadio,
  type NetworkFrame,
  type Observation,
  type RomSource,
  type Slice,
  type WifiSpec,
} from "@replicas/core";
import type { EngineAbi } from "./engine-abi";
import { LoadKind } from "./engine-abi";
import type { GuestModule } from "./guest-module";
import type { HostBoardBridge } from "./host-board-bridge";
import type { HostImports } from "./host-imports";
import { NatRecords } from "./nat-records";
import { Outbox, type ConsoleSource } from "./outbox";

const HOST_BOARD_FOR_CHIP = { esp32s3: "host", esp32: "host-esp32" } as const;
const MAX_CONSOLE_BYTES_PER_MESSAGE = 32_768;
const RELAY_FLAGS = 0b111;
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
export class WasmEmulatorEngine implements EmulatorEngine, GuestRadio {
  private emulator: number | undefined;
  private chip: BoardDeclaration["chip"] | undefined;
  private pendingConsole = "";
  private pendingFrames: NetworkFrame[] = [];
  private readonly analogVolts = new Map<number, number>();

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
    this.pendingFrames = [];
    this.analogVolts.clear();
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
    if (input.kind === "uart") {
      this.requireOk({ code: this.parts.abi.uartInput({ emulator, pin: input.pin, baud: input.baud, bytes: input.bytes }), what: `UART input on GPIO${input.pin}` });
      return;
    }
    this.setAnalog({ emulator, gpio: input.gpio, volts: input.volts });
  }

  attachWifi(spec: WifiSpec): void {
    const emulator = this.created();
    this.requireOk({ code: this.parts.abi.wifi({ emulator, spec: `ssid=${spec.ssid},psk=${spec.psk}` }), what: "the access point" });
    this.requireOk({ code: this.parts.abi.natRelay({ emulator, flags: RELAY_FLAGS }), what: "the network relay" });
    this.requireOk({ code: this.parts.abi.netmon(emulator), what: "the network monitor" });
  }

  takeFlowRequests(): readonly FlowRequest[] {
    return NatRecords.parse(this.parts.abi.natTake(this.created()));
  }

  answer(answer: FlowAnswer): number {
    return this.parts.abi.natEvent({ emulator: this.created(), ...NatRecords.encode(answer) });
  }

  takeNetworkFrames(): readonly NetworkFrame[] {
    this.drain(this.created());
    const frames = this.pendingFrames;
    this.pendingFrames = [];
    return frames;
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
    this.pendingFrames.push(...Outbox.networkFrames(messages));
  }

  /** An analogue level is a script action; each call loads the whole table, so the guest always sees the latest voltages. */
  private setAnalog(args: { emulator: number; gpio: number; volts: number }): void {
    this.analogVolts.set(args.gpio, args.volts);
    const script = Array.from(this.analogVolts, ([gpio, volts]) => `0 adc ${gpio} ${volts}`).join("\n");
    this.requireOk({ code: this.parts.abi.load({ emulator: args.emulator, kind: LoadKind.SCRIPT, bytes: new TextEncoder().encode(script) }), what: "the analogue level" });
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
