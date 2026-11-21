import type { ChipFamily } from "../board-facts";
import type { Observation } from "../observation";
import type { Slice } from "../run-plan";

/** What the host answers for the board: the engine forwards exactly these events, and no others. */
export interface BoardDeclaration {
  readonly chip: ChipFamily;
  readonly flashBytes: number;
  readonly psramBytes: number;
  readonly i2cAddresses: readonly { readonly bus: number; readonly address: number }[];
  readonly routesSpiToHost: boolean;
  readonly routesUartToHost: boolean;
  readonly routesLcdToHost: boolean;
  /** The GPIO the board's display uses to tell a command from data; the bridge tracks its level for each SPI transaction. */
  readonly dataCommandGpio?: number;
}

export interface FlashImage {
  readonly bytes: Uint8Array;
  readonly offset: number;
}

export type EngineInput =
  | { readonly kind: "console"; readonly bytes: Uint8Array }
  | { readonly kind: "gpio"; readonly gpio: number; readonly level: boolean }
  /** The boot-mode strapping pins the mask ROM samples at the next reset (GPIO_STRAP_REG); set before boot. */
  | { readonly kind: "strap"; readonly value: number }
  | { readonly kind: "adc"; readonly gpio: number; readonly volts: number };

/** The refusal of every call that needs a created engine. */
export class EngineNotCreated extends Error {
  constructor() {
    super("create() has not been called");
  }
}

export interface EmulatorEngine {
  /** Builds the board; a second call first frees the engine the first one made. */
  create(declaration: BoardDeclaration): Promise<void>;
  /** Frees the engine; every call but `create` is refused until the next `create`. */
  destroy(): void;
  load(image: FlashImage): void;
  boot(): void;
  run(slice: Slice): void;
  sendInput(input: EngineInput): void;
  takeOutput(): Observation;
}
