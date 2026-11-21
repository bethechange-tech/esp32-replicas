import type { Output } from "@replicas/core";
import { ArgumentsRefused, RunArgumentParser } from "./run-arguments";
import { EXIT_REFUSED, type RunCommand } from "./commands/run-command";

/** The command line: reads the arguments, hands `run` to its command, and turns a refusal into a named line and an exit code. */
export class Cli {
  constructor(
    private readonly parts: {
      readonly run: RunCommand;
      readonly output: Output;
    },
  ) {}

  async execute(argv: readonly string[]): Promise<number> {
    try {
      return await this.parts.run.execute(RunArgumentParser.parse(argv));
    } catch (error) {
      if (!(error instanceof ArgumentsRefused)) throw error;
      this.parts.output.write(`${error.message}\n`);
      return EXIT_REFUSED;
    }
  }
}
