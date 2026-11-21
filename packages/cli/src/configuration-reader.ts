export interface CliConfiguration {
  /** The checkout the engine, ROMs and facts are found in. */
  readonly root: string;
  readonly argv: readonly string[];
}

/** The one place the environment and the arguments are read. */
export class ConfigurationReader {
  private constructor() {}

  static read(): CliConfiguration {
    return { root: process.env["REPLICA_ROOT"] ?? process.cwd(), argv: process.argv.slice(2) };
  }
}
