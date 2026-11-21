import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HostWire } from "./host-wire";

const HOST_BOARD_RS = path.resolve(import.meta.dirname, "../../../../../third_party/esp32sim/wasm/src/host_board.rs");

function rustConstants(): Map<string, number> {
  const source = readFileSync(HOST_BOARD_RS, "utf8");
  const wire = /mod wire \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  return new Map([...wire.matchAll(/pub const (\w+): \w+ = (\d+);/g)].map((m) => [m[1] ?? "", Number(m[2])]));
}

describe("the host-board wire layout is one fact in two languages", () => {
  const rust = rustConstants();

  it("has the numbers the TypeScript host reads, literally", () => {
    expect(HostWire.GPIO_RECORD_BYTES).toBe(16);
    expect(HostWire.SPI_HEADER_BYTES).toBe(8);
    expect([HostWire.GPIO_PIN_OFFSET, HostWire.GPIO_LEVEL_OFFSET, HostWire.SPI_HOST_OFFSET, HostWire.SPI_READ_LENGTH_OFFSET]).toEqual([8, 9, 0, 4]);
    expect(HostWire.FRAME_DIMENSION_BITS).toBe(16);
    expect([HostWire.I2C_BUS_SHIFT, HostWire.I2C_ADDRESS_SHIFT, HostWire.I2C_FLAG_SHIFT]).toEqual([24, 16, 8]);
    expect([HostWire.OP_START, HostWire.OP_WRITE, HostWire.OP_READ, HostWire.OP_STOP]).toEqual([0, 1, 2, 3]);
  });

  it("matches host_board.rs for every constant it names", () => {
    expect(rust.size).toBe(14);
    for (const name of ["GPIO_RECORD_BYTES", "GPIO_PIN_OFFSET", "GPIO_LEVEL_OFFSET", "SPI_HEADER_BYTES", "SPI_HOST_OFFSET", "SPI_READ_LENGTH_OFFSET", "FRAME_DIMENSION_BITS", "I2C_BUS_SHIFT", "I2C_ADDRESS_SHIFT", "I2C_FLAG_SHIFT", "OP_START", "OP_WRITE", "OP_READ", "OP_STOP"] as const) {
      expect(rust.get(name), name).toBe(HostWire[name]);
    }
  });
});
