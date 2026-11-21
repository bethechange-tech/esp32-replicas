import { Sha256Token } from "./sha256-token.ts";

class GuardHashCommand {
  private constructor() {}

  static run(names: readonly string[]): void {
    if (names.length === 0) {
      process.stderr.write("usage: pnpm guard:hash <host or key prefix>...\n");
      process.exitCode = 1;
      return;
    }
    for (const name of names) process.stdout.write(`"${Sha256Token.of(name)}",\n`);
  }
}

GuardHashCommand.run(process.argv.slice(2));
