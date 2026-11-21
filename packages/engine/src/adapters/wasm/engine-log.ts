/** Where the engine's own log lines go (`host_log`). */
export interface EngineLog {
  write(message: string): void;
}
