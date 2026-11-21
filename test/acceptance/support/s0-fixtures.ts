import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BoardDeclaration, ChipFamily } from "@replicas/core";
import { DirectoryRomSource } from "@replicas/firmware";
import { RepositoryRoot } from "../../guards/support/temp-tree";

const ENGINE_FIRMWARE = "third_party/esp32sim/web/wasm/fw/public";
const GOLDENS = "third_party/esp32sim/tests/golden";
const FLASH_BYTES_S3 = 8 * 1024 * 1024;
const PSRAM_BYTES_S3 = 2 * 1024 * 1024;
const FLASH_BYTES_CLASSIC = 4 * 1024 * 1024;
const PARTITION_TABLE_OFFSET = 0x8000;
const APP_OFFSET = 0x10000;
const BOOTLOADER_OFFSET: Readonly<Record<ChipFamily, number>> = { esp32s3: 0x0, esp32: 0x1000 };
const ERASED = 0xff;
const FIRMWARE_NAMES: Readonly<Record<ChipFamily, { bootloader: string; table: string; app: string; golden: string }>> = {
  esp32s3: { bootloader: "hello-bootloader.bin", table: "hello-ptable.bin", app: "hello_world.bin", golden: "hello-s3.console.txt" },
  esp32: { bootloader: "classic-hello-bootloader.bin", table: "classic-hello-ptable.bin", app: "classic-hello_world.bin", golden: "hello-classic.console.txt" },
};

/** What the engine tests stand on: the built module, the downloaded ROMs, and upstream's own hello_world images and goldens. */
export class S0Fixtures {
  static readonly CONSOLE_SECONDS = 3;
  static readonly SLICE_CYCLES = 2_000_000;
  static readonly START_UNIX_MILLISECONDS = 1_780_000_000_000;

  private constructor() {}

  static wasmPath(): string {
    return path.join(RepositoryRoot.PATH, "build/esp32sim.wasm");
  }

  static romDirectory(): string {
    return path.join(RepositoryRoot.PATH, "build/roms");
  }

  /** The module and both ROMs are present: a checkout that has not built the engine skips these tests, and CI builds first. */
  static engineReady(): boolean {
    const roms = Object.values(DirectoryRomSource.PINNED).map((rom) => path.join(S0Fixtures.romDirectory(), rom.file));
    return [S0Fixtures.wasmPath(), ...roms].every((file) => existsSync(file));
  }

  static wasm(): Uint8Array {
    return readFileSync(S0Fixtures.wasmPath());
  }

  static declaration(chip: ChipFamily): BoardDeclaration {
    return {
      chip,
      flashBytes: chip === "esp32s3" ? FLASH_BYTES_S3 : FLASH_BYTES_CLASSIC,
      psramBytes: chip === "esp32s3" ? PSRAM_BYTES_S3 : 0,
      i2cAddresses: [],
      routesSpiToHost: false,
      routesUartToHost: false,
      routesLcdToHost: false,
    };
  }

  /** Upstream's stock hello_world as one flash image: bootloader, partition table and app at the chip's offsets. */
  static helloImage(chip: ChipFamily): Uint8Array {
    const names = FIRMWARE_NAMES[chip];
    const part = (file: string): Uint8Array => readFileSync(path.join(RepositoryRoot.PATH, ENGINE_FIRMWARE, file));
    const app = part(names.app);
    const image = new Uint8Array(APP_OFFSET + app.length).fill(ERASED);
    image.set(part(names.bootloader), BOOTLOADER_OFFSET[chip]);
    image.set(part(names.table), PARTITION_TABLE_OFFSET);
    image.set(app, APP_OFFSET);
    return image;
  }

  /** What upstream's CLI prints on UART0 for this image in 3 emulated seconds (its checked-in golden). */
  static helloGolden(chip: ChipFamily): string {
    return readFileSync(path.join(RepositoryRoot.PATH, GOLDENS, FIRMWARE_NAMES[chip].golden), "utf8");
  }
}
