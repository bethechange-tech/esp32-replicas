import type { BoardId, WifiSpec } from "@replicas/core";

const DEFAULT_WIFI: WifiSpec = { ssid: "replica-lab", psk: "replica-lab-pass" };
const DEFAULT_SECONDS = 20;
const LOCAL = "local";
const BOARDS: readonly BoardId[] = ["small-screen", "small-screen-touch", "panel-7", "headless"];

export class ArgumentsRefused extends Error {
  constructor(why: string) {
    super(`arguments refused: ${why}`);
  }
}

export interface RunArguments {
  readonly board: BoardId;
  readonly image: string;
  readonly wifi: WifiSpec;
  /** Names the image dials that the run answers with a local listener. */
  readonly mappedNames: readonly string[];
  readonly seconds: number;
}

/** `run --board ID --image PATH [--wifi ssid=..,psk=..] [--map NAME=local]... [--seconds N]`. An unknown option or value is refused by name. */
export class RunArgumentParser {
  private constructor() {}

  static parse(argv: readonly string[]): RunArguments {
    const [command, ...options] = argv;
    if (command !== "run") throw new ArgumentsRefused(`unknown command ${command ?? "(none)"}`);
    const values = new Map<string, string[]>();
    for (let at = 0; at < options.length; at += 2) {
      const flag = options[at] ?? "";
      const value = options[at + 1];
      if (!flag.startsWith("--") || value === undefined) throw new ArgumentsRefused(`${flag} needs a value`);
      values.set(flag, [...(values.get(flag) ?? []), value]);
    }
    return {
      board: RunArgumentParser.board(RunArgumentParser.one({ values, flag: "--board" })),
      image: RunArgumentParser.one({ values, flag: "--image" }),
      wifi: RunArgumentParser.wifi(values.get("--wifi")?.[0]),
      mappedNames: (values.get("--map") ?? []).map(RunArgumentParser.mappedName),
      seconds: RunArgumentParser.seconds(values.get("--seconds")?.[0]),
    };
  }

  private static one(args: { values: Map<string, string[]>; flag: string }): string {
    const value = args.values.get(args.flag)?.[0];
    if (value === undefined) throw new ArgumentsRefused(`${args.flag} is required`);
    return value;
  }

  private static board(value: string): BoardId {
    const board = BOARDS.find((candidate) => candidate === value);
    if (!board) throw new ArgumentsRefused(`unknown board ${value}`);
    return board;
  }

  private static wifi(value: string | undefined): WifiSpec {
    if (value === undefined) return DEFAULT_WIFI;
    const fields = Object.fromEntries(value.split(",").map((pair) => pair.split("=") as [string, string]));
    if (!fields["ssid"] || fields["psk"] === undefined) throw new ArgumentsRefused("--wifi needs ssid=NAME,psk=PASSWORD");
    return { ssid: fields["ssid"], psk: fields["psk"] };
  }

  private static mappedName(value: string): string {
    const [name, target] = value.split("=");
    if (!name || target !== LOCAL) throw new ArgumentsRefused(`--map takes NAME=${LOCAL}, not ${value}`);
    return name;
  }

  private static seconds(value: string | undefined): number {
    if (value === undefined) return DEFAULT_SECONDS;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new ArgumentsRefused(`--seconds ${value} is not a positive number`);
    return seconds;
  }
}
