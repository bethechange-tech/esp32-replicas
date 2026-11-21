import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe } from "vitest";
import { NodeSocketNetwork, OfflineNetwork } from "@replicas/network";
import { FlashImageValidator, UserImageSource } from "@replicas/firmware";
import { EmulatorEngineContract } from "../contracts/emulator-engine.contract";
import { FirmwareSourceContract } from "../contracts/firmware-source.contract";
import { GuestNetworkContract } from "../contracts/guest-network.contract";
import { FixedBoardFacts } from "../fakes/fixed-board-facts";
import { InMemoryFirmwareSource } from "../fakes/in-memory-firmware-source";
import { RecordingBoardReplica } from "../fakes/recording-board-replica";
import { ScriptedEmulatorEngine } from "../fakes/scripted-emulator-engine";
import { S0EngineHarness } from "./support/s0-engine-harness";
import { S0Fixtures } from "./support/s0-fixtures";

const BANNER = "ESP-ROM:esp32s3";
const MEGABYTE = 1024 * 1024;
const SLICE = { cycles: S0Fixtures.SLICE_CYCLES, unixMilliseconds: S0Fixtures.START_UNIX_MILLISECONDS };
const image = { bytes: S0Fixtures.helloImage("esp32s3"), offset: 0 };

describe("the shared contract suites (AC0b.6)", () => {
  describe.skipIf(!S0Fixtures.engineReady())("with the built engine", () => {
    EmulatorEngineContract.register({
      name: "WasmEmulatorEngine",
      make: () => ({
        engine: S0EngineHarness.engine(new RecordingBoardReplica()),
        declaration: S0Fixtures.declaration("esp32s3"),
        image,
        bannerPart: BANNER,
        slice: SLICE,
      }),
    });
  });

  EmulatorEngineContract.register({
    name: "ScriptedEmulatorEngine",
    make: () => ({
      engine: new ScriptedEmulatorEngine([`${BANNER}-20210327\r\n`]),
      declaration: S0Fixtures.declaration("esp32s3"),
      image,
      bannerPart: BANNER,
      slice: SLICE,
    }),
  });

  GuestNetworkContract.register({ name: "OfflineNetwork", make: () => new OfflineNetwork() });
  GuestNetworkContract.register({
    name: "NodeSocketNetwork",
    make: () => new NodeSocketNetwork({ "broker.replica.test": { host: "127.0.0.1", port: 1 } }),
  });

  const directory = mkdtempSync(path.join(tmpdir(), "firmware-contract-"));
  const validFile = path.join(directory, "factory.bin");
  const invalidFile = path.join(directory, "corrupt.bin");
  writeFileSync(validFile, S0Fixtures.helloImage("esp32s3"));
  writeFileSync(invalidFile, new Uint8Array(FlashImageValidator.PARTITION_TABLE_OFFSET + FlashImageValidator.PARTITION_TABLE_BYTES));
  const expectations = { chip: "esp32s3", flashBytes: 8 * MEGABYTE } as const;
  const boards = new FixedBoardFacts({ chip: "esp32s3", flashBytes: 8 * MEGABYTE });

  FirmwareSourceContract.register({
    name: "UserImageSource",
    chip: "esp32s3",
    flashBytes: 8 * MEGABYTE,
    make: () => ({ valid: new UserImageSource({ path: validFile, boards }), invalid: new UserImageSource({ path: invalidFile, boards }) }),
  });
  FirmwareSourceContract.register({
    name: "InMemoryFirmwareSource",
    chip: "esp32s3",
    flashBytes: 8 * MEGABYTE,
    make: () => ({
      valid: new InMemoryFirmwareSource({ bytes: S0Fixtures.helloImage("esp32s3"), expectations }),
      invalid: new InMemoryFirmwareSource({ bytes: new Uint8Array(1), expectations }),
    }),
  });
});
