import { describe, expect, it } from "vitest";
import { BoundsCheck, UnitBounds } from "./units";
import { PublicSource } from "./board-facts";

describe("unit bounds are asserted as numbers", () => {
  it("GPIO covers the ESP32-S3 pins", () => {
    expect(UnitBounds.GPIO).toEqual({ min: 0, max: 48 });
  });

  it("an I2C address is seven bits", () => {
    expect(UnitBounds.I2C_ADDRESS).toEqual({ min: 0, max: 127 });
  });

  it("a divider ratio, baud rate and pixel count have their declared limits", () => {
    expect(UnitBounds.DIVIDER_RATIO).toEqual({ min: 1, max: 100 });
    expect(UnitBounds.BAUD).toEqual({ min: 1200, max: 5_000_000 });
    expect(UnitBounds.PIXELS).toEqual({ min: 1, max: 4096 });
  });
});

describe("BoundsCheck", () => {
  it("accepts the edges and refuses outside, naming the field and the range", () => {
    expect(BoundsCheck.contains({ bounds: UnitBounds.GPIO, value: 48 })).toBe(true);
    expect(BoundsCheck.refusal({ name: "gpio", bounds: UnitBounds.GPIO, value: 49 })).toBe(
      "gpio 49 is outside 0 to 48",
    );
    expect(BoundsCheck.refusal({ name: "gpio", bounds: UnitBounds.GPIO, value: Number.NaN })).toBeDefined();
  });
});

describe("PublicSource", () => {
  it("is an https address only", () => {
    expect(PublicSource.isPublic("https://example.org/datasheet")).toBe(true);
    expect(PublicSource.isPublic("http://example.org/datasheet")).toBe(false);
    expect(PublicSource.isPublic("file:///datasheet")).toBe(false);
  });
});
