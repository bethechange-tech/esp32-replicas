import type { BoardId } from "./board-facts";

export interface WifiSpec {
  readonly ssid: string;
  readonly psk: string;
}

/** Fixed inputs, so that a run is repeatable: same MAC, same clock, same duration. */
export interface RunPlan {
  readonly board: BoardId;
  readonly macAddress: string;
  readonly wifi: WifiSpec;
  readonly emulatedMilliseconds: number;
  readonly startUnixMilliseconds: number;
}

export interface Slice {
  readonly cycles: number;
  readonly unixMilliseconds: number;
}
