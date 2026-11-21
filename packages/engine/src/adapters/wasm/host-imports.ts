import type { EngineLog } from "./engine-log";
import type { GuestModule } from "./guest-module";
import type { HostBoardBridge } from "./host-board-bridge";
import type { JitHost } from "./jit-host";

/** The functions the module imports from its host: its log, its block compiler and the host board. */
export class HostImports {
  constructor(
    private readonly parts: {
      readonly guest: GuestModule;
      readonly bridge: HostBoardBridge;
      readonly jit: JitHost;
      readonly log: EngineLog;
    },
  ) {}

  build(): WebAssembly.Imports {
    const { guest, bridge, jit, log } = this.parts;
    return {
      env: {
        host_log: (pointer: number, length: number): void => log.write(guest.text({ pointer, length })),
        host_jit_compile: (pointer: number, length: number): number => jit.compile({ pointer, length }),
        host_jit_release: (slot: number): void => jit.release(slot),
        host_board_gpio: (pointer: number, count: number): void => bridge.gpio({ pointer, count }),
        host_board_spi: (pointer: number, length: number): number => bridge.spi({ pointer, length }),
        host_board_i2c: (op: number, packed: number): number => bridge.i2c({ op, packed }),
        host_board_uart_tx: (port: number, byte: number): void => bridge.uartTx({ port, byte }),
        host_board_lcd_frame: (dimensions: number, pointer: number): void => bridge.lcdFrame({ dimensions, pointer }),
      },
    };
  }
}
