import { describe, expect, it } from "vitest";
import type { BoardDeclaration } from "@replicas/core";
import { RecordingBoardReplica } from "../../../../../test/fakes/recording-board-replica";
import { GuestModule } from "./guest-module";
import { HostBoardBridge } from "./host-board-bridge";
import { HostWire } from "./host-wire";

const DC_GPIO = 4;
const DECLARATION: BoardDeclaration = {
  chip: "esp32s3",
  flashBytes: 1,
  psramBytes: 0,
  i2cAddresses: [],
  routesSpiToHost: true,
  routesUartToHost: true,
  routesLcdToHost: true,
  dataCommandGpio: DC_GPIO,
};
const PAGE = 65_536;

function setup(replica = new RecordingBoardReplica()) {
  const guest = new GuestModule();
  guest.bind({ memory: new WebAssembly.Memory({ initial: 1 }) });
  const bridge = new HostBoardBridge(replica, guest);
  bridge.attach(DECLARATION);
  return { guest, bridge, replica };
}

function gpioRecords(edges: readonly { cycle: number; pin: number; level: boolean }[]): Uint8Array {
  const bytes = new Uint8Array(edges.length * HostWire.GPIO_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  edges.forEach((edge, index) => {
    const base = index * HostWire.GPIO_RECORD_BYTES;
    view.setBigUint64(base, BigInt(edge.cycle), true);
    bytes[base + HostWire.GPIO_PIN_OFFSET] = edge.pin;
    bytes[base + HostWire.GPIO_LEVEL_OFFSET] = edge.level ? 1 : 0;
  });
  return bytes;
}

function spiRequest(args: { host: number; readLength: number; mosi: readonly number[] }): Uint8Array {
  const bytes = new Uint8Array(HostWire.SPI_HEADER_BYTES + args.mosi.length);
  bytes[HostWire.SPI_HOST_OFFSET] = args.host;
  new DataView(bytes.buffer).setUint32(HostWire.SPI_READ_LENGTH_OFFSET, args.readLength, true);
  bytes.set(args.mosi, HostWire.SPI_HEADER_BYTES);
  return bytes;
}

function pack(args: { bus: number; address?: number; flag?: boolean; byte?: number }): number {
  return (
    ((args.bus << HostWire.I2C_BUS_SHIFT) | ((args.address ?? 0) << HostWire.I2C_ADDRESS_SHIFT) | ((args.flag ? 1 : 0) << HostWire.I2C_FLAG_SHIFT) | (args.byte ?? 0)) >>> 0
  );
}

describe("HostBoardBridge (AC0b.4, the bridge half)", () => {
  it("answers a guest I2C read synchronously from the replica, with an acknowledgement for start and write", () => {
    const { bridge, replica } = setup(new RecordingBoardReplica({ i2cAddress: 0x15, i2cReadByte: 0xa5 }));
    expect(bridge.i2c({ op: HostWire.OP_START, packed: pack({ bus: 0, address: 0x15 }) })).toBe(1);
    expect(bridge.i2c({ op: HostWire.OP_WRITE, packed: pack({ bus: 0, byte: 0x0f }) })).toBe(1);
    expect(bridge.i2c({ op: HostWire.OP_START, packed: pack({ bus: 0, address: 0x15, flag: true }) })).toBe(1);
    expect(bridge.i2c({ op: HostWire.OP_READ, packed: pack({ bus: 0 }) })).toBe(0xa5);
    bridge.i2c({ op: HostWire.OP_STOP, packed: pack({ bus: 0 }) });
    expect(replica.i2c).toEqual([
      { kind: "start", bus: 0, address: 0x15, read: false },
      { kind: "write", bus: 0, byte: 0x0f },
      { kind: "start", bus: 0, address: 0x15, read: true },
      { kind: "read", bus: 0 },
      { kind: "stop", bus: 0 },
    ]);
  });

  it("does not acknowledge an address the replica does not answer for", () => {
    const { bridge } = setup(new RecordingBoardReplica({ i2cAddress: 0x15 }));
    expect(bridge.i2c({ op: HostWire.OP_START, packed: pack({ bus: 0, address: 0x40 }) })).toBe(0);
  });

  it("hands SPI bytes over in order, each with the data/command level of its own moment", () => {
    const { guest, bridge, replica } = setup(new RecordingBoardReplica({ spiReply: Uint8Array.from([0x11, 0x22, 0x33]) }));
    const at = PAGE / 2;
    const spi = (mosi: number[]): number => {
      guest.write({ pointer: at, bytes: spiRequest({ host: 2, readLength: 2, mosi }) });
      return bridge.spi({ pointer: at, length: HostWire.SPI_HEADER_BYTES + mosi.length });
    };
    guest.write({ pointer: 0, bytes: gpioRecords([{ cycle: 10, pin: DC_GPIO, level: false }]) });
    bridge.gpio({ pointer: 0, count: 1 });
    expect(spi([0x2a])).toBe(2);
    guest.write({ pointer: 0, bytes: gpioRecords([{ cycle: 20, pin: DC_GPIO, level: true }]) });
    bridge.gpio({ pointer: 0, count: 1 });
    spi([0x00, 0x14]);
    expect(replica.spi.map((t) => [t.host, [...t.mosi], t.readLength, t.dataCommandLevel])).toEqual([
      [2, [0x2a], 2, false],
      [2, [0x00, 0x14], 2, true],
    ]);
    expect([...guest.read({ pointer: at, length: 2 })]).toEqual([0x11, 0x22]);
  });

  it("reads GPIO records into edges with their cycle, and keeps them for the run's observation", () => {
    const { guest, bridge, replica } = setup();
    guest.write({ pointer: 0, bytes: gpioRecords([{ cycle: 5, pin: 2, level: true }, { cycle: 2 ** 40, pin: 40, level: false }]) });
    bridge.gpio({ pointer: 0, count: 2 });
    expect(replica.gpio).toEqual([
      { atCycle: 5, gpio: 2, level: true },
      { atCycle: 2 ** 40, gpio: 40, level: false },
    ]);
    expect(bridge.takeObservations().gpioEdges).toHaveLength(2);
    expect(bridge.takeObservations().gpioEdges).toEqual([]);
  });

  it("passes UART transmit bytes and LCD frames to the replica", () => {
    const { guest, bridge, replica } = setup();
    bridge.uartTx({ port: 1, byte: 0xff });
    const width = 3;
    const height = 2;
    guest.write({ pointer: 100, bytes: Uint8Array.from({ length: width * height * HostWire.RGB565_BYTES }, (_, i) => i) });
    bridge.lcdFrame({ dimensions: (width << HostWire.FRAME_DIMENSION_BITS) | height, pointer: 100 });
    expect(replica.uart).toEqual([{ uart: 1, byte: 0xff }]);
    expect(replica.frames[0]?.width).toBe(width);
    expect(replica.frames[0]?.height).toBe(height);
    expect(replica.frames[0]?.rgb565).toHaveLength(12);
    expect(bridge.takeObservations().frames).toHaveLength(1);
  });
});
