import { Composition } from "./composition";
import { ConfigurationReader } from "./configuration-reader";

const configuration = ConfigurationReader.read();
process.exitCode = await Composition.cli({ root: configuration.root, output: Composition.standardOutput() }).execute(configuration.argv);
