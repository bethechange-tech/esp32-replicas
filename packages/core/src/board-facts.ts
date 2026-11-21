import type { Unit } from "./units";

export type BoardId = "small-screen" | "small-screen-touch" | "panel-7" | "headless";

export type ChipFamily = "esp32s3" | "esp32";

/** A number or name with the unit it is in and the public page that states it. */
export interface Fact<T> {
  readonly value: T;
  readonly unit: Unit;
  readonly source: string;
}

export interface BoardFacts {
  readonly id: BoardId;
  readonly model: Fact<string>;
  readonly chip: Fact<ChipFamily>;
  readonly flashBytes: Fact<number>;
  readonly psramBytes: Fact<number>;
}

export class PublicSource {
  private constructor() {}

  static isPublic(source: string): boolean {
    return source.startsWith("https://") && !source.includes(" ");
  }
}
