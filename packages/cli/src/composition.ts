import { readFileSync } from "node:fs";
import path from "node:path";
import { FactLookup, type BoardDeclaration, type BoardFactsSource, type BoardId, type BoardReplica, type FirmwareSource, type GuestNetwork, type Output, type WifiSpec } from "@replicas/core";
import { PanelBoard, SmallScreenBoard, type SmallScreenDevices } from "@replicas/boards";
import { BacklightHelper, Cst816, DcsPanel, Gt911, Ina226, LineSource, PowerLatch, RgbFrame } from "@replicas/devices";
import {
  EngineAbi,
  GuestModule,
  HostBoardBridge,
  HostImports,
  JitHost,
  WasmEmulatorEngine,
  type ConsoleSource,
  type EngineLog,
} from "@replicas/engine";
import { DirectoryRomSource, FileBoardFacts, UserImageSource } from "@replicas/firmware";
import { NodeSocketNetwork, OfflineNetwork, TlsHelloListener } from "@replicas/network";
import { BoardRun } from "./board-run";
import { Cli } from "./cli";
import { BoardNotAvailable, RunCommand, type BoardSession, type BoardSessions, type ImageSources } from "./commands/run-command";
import { NetworkRelay } from "./network-relay";
import { StandardOutput } from "./standard-output";

const ENGINE_FILE = "build/esp32sim.wasm";
const ROM_DIRECTORY = "build/roms";
const FACTS_FILE = "facts/boards.json";
const START_UNIX_MILLISECONDS = 1_780_000_000_000;

export interface CliOptions {
  readonly root: string;
  readonly output: Output;
}

class SilentEngineLog implements EngineLog {
  write(): void {}
}

class UserImageSources implements ImageSources {
  constructor(private readonly boards: BoardFactsSource) {}

  at(imagePath: string): FirmwareSource {
    return new UserImageSource({ path: imagePath, boards: this.boards });
  }
}

/** Opens a small-screen, small-screen-touch or panel-7 run; each mapped name is answered by a local listener that records the hello and refuses the handshake. */
class SmallScreenSessions implements BoardSessions {
  constructor(private readonly root: string) {}

  private composer(board: BoardId): (options: SmallScreenOptions) => { readonly run: BoardRun } {
    if (board === "small-screen") return (options) => Composition.smallScreen(options);
    if (board === "small-screen-touch") return (options) => Composition.smallScreenTouch(options);
    if (board === "panel-7") return (options) => Composition.panel(options);
    throw new BoardNotAvailable(board);
  }

  async open(args: { board: BoardId; mappedNames: readonly string[]; wifi: WifiSpec }): Promise<BoardSession> {
    const compose = this.composer(args.board);
    const listeners = args.mappedNames.map(() => TlsHelloListener.refusing());
    const endpoints = await Promise.all(listeners.map((listener) => listener.listen()));
    const network: GuestNetwork = args.mappedNames.length === 0 ? new OfflineNetwork() : new NodeSocketNetwork(Object.fromEntries(args.mappedNames.map((name, index) => [name, endpoints[index] as (typeof endpoints)[number]])));
    const composed = compose({
      wasm: readFileSync(path.join(this.root, ENGINE_FILE)),
      romDirectory: path.join(this.root, ROM_DIRECTORY),
      factsPath: path.join(this.root, FACTS_FILE),
      network,
      log: new SilentEngineLog(),
      startUnixMilliseconds: START_UNIX_MILLISECONDS,
    });
    return {
      run: composed.run,
      close: async () => {
        await network.close();
        await Promise.all(listeners.map((listener) => listener.close()));
      },
    };
  }
}

export interface EngineOptions {
  /** The compiled engine module's bytes (`build/esp32sim.wasm`). */
  readonly wasm: Uint8Array;
  readonly romDirectory: string;
  readonly replica: BoardReplica;
  readonly console: ConsoleSource;
  readonly log: EngineLog;
}

export interface SmallScreenOptions {
  readonly wasm: Uint8Array;
  readonly romDirectory: string;
  readonly factsPath: string;
  readonly network: GuestNetwork;
  readonly log: EngineLog;
  readonly startUnixMilliseconds: number;
}

export interface SmallScreenRun {
  readonly board: SmallScreenBoard;
  readonly run: BoardRun;
}

export interface PanelRun {
  readonly board: PanelBoard;
  readonly run: BoardRun;
}

/** The composition root: the one place the concrete classes are chosen and joined. */
export class Composition {
  private constructor() {}

  static engine(options: EngineOptions): WasmEmulatorEngine {
    const guest = new GuestModule();
    const bridge = new HostBoardBridge(options.replica, guest);
    const jit = new JitHost(guest);
    return new WasmEmulatorEngine({
      wasm: options.wasm,
      roms: new DirectoryRomSource(options.romDirectory),
      guest,
      abi: new EngineAbi(guest),
      bridge,
      imports: new HostImports({ guest, bridge, jit, log: options.log }),
      console: options.console,
    });
  }

  static standardOutput(): Output {
    return new StandardOutput();
  }

  static cli(options: CliOptions): Cli {
    const boards = new FileBoardFacts(path.join(options.root, FACTS_FILE));
    return new Cli({
      run: new RunCommand({ images: new UserImageSources(boards), sessions: new SmallScreenSessions(options.root), output: options.output }),
      output: options.output,
    });
  }

  static smallScreen(options: SmallScreenOptions): SmallScreenRun {
    const facts = new FileBoardFacts(options.factsPath).facts("small-screen");
    return Composition.run({ options, board: SmallScreenBoard.withoutTouch({ facts, devices: Composition.smallScreenDevices(facts) }) });
  }

  static smallScreenTouch(options: SmallScreenOptions): SmallScreenRun {
    const facts = new FileBoardFacts(options.factsPath).facts("small-screen-touch");
    const touch = new Cst816({
      address: FactLookup.number({ facts, name: "touch-address" }),
      interruptGpio: FactLookup.pin({ facts, name: "touch-interrupt" }),
      resetGpio: FactLookup.pin({ facts, name: "touch-reset" }),
    });
    return Composition.run({ options, board: SmallScreenBoard.withTouch({ facts, devices: Composition.smallScreenDevices(facts), touch }) });
  }

  static panel(options: SmallScreenOptions): PanelRun {
    const facts = new FileBoardFacts(options.factsPath).facts("panel-7");
    const number = (name: string): number => FactLookup.number({ facts, name });
    const columns = number("display-visible-columns");
    const rows = number("display-visible-rows");
    const board = new PanelBoard({
      facts,
      devices: {
        display: new RgbFrame({ columns, rows }),
        backlight: new BacklightHelper({ address: number("backlight-helper-address"), onCommand: number("backlight-helper-on-command") }),
        touch: new Gt911({ address: number("touch-address"), columns, rows }),
      },
    });
    return { board, run: Composition.boardRun({ options, board }) };
  }

  private static run(args: { options: SmallScreenOptions; board: SmallScreenBoard }): SmallScreenRun {
    return { board: args.board, run: Composition.boardRun(args) };
  }

  private static boardRun(args: { options: SmallScreenOptions; board: BoardReplica & { declaration(): BoardDeclaration } }): BoardRun {
    const { options, board } = args;
    const engine = Composition.engine({ wasm: options.wasm, romDirectory: options.romDirectory, replica: board, console: "uart0", log: options.log });
    return new BoardRun({
      engine,
      board,
      declaration: board.declaration(),
      relay: new NetworkRelay(engine, options.network),
      startUnixMilliseconds: options.startUnixMilliseconds,
    });
  }

  private static smallScreenDevices(facts: ReturnType<BoardFactsSource["facts"]>): SmallScreenDevices {
    const number = (name: string): number => FactLookup.number({ facts, name });
    const pin = (name: string): number => FactLookup.pin({ facts, name });
    return {
      panel: new DcsPanel({
        ramColumns: number("display-ram-columns"),
        ramRows: number("display-ram-rows"),
        visibleColumns: number("display-visible-columns"),
        visibleRows: number("display-visible-rows"),
        columnOffset: number("display-column-offset"),
        rowOffset: number("display-row-offset"),
        glassMirrorsColumns: FactLookup.decision({ facts, name: "display-mirror-x" }),
        glassMirrorsRows: FactLookup.decision({ facts, name: "display-mirror-y" }),
      }),
      currentMonitor: new Ina226(number("current-monitor-address")),
      powerLatch: new PowerLatch(pin("power-latch")),
      line: new LineSource({ pin: pin("line-receive"), baud: number("line-baud") }),
    };
  }
}
