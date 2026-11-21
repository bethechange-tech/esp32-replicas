import { S1Fixtures } from "../acceptance/support/s1-fixtures";
import { S2Fixtures } from "../acceptance/support/s2-fixtures";
import { S3Fixtures } from "../acceptance/support/s3-fixtures";

/** Under `pnpm test:full` (CI) a missing engine, ROM or sample is a failure, not a skipped suite. */
class RequireBuiltArtifacts {
  private constructor() {}

  static assertPresent(): void {
    if (!S1Fixtures.ready() || !S2Fixtures.ready() || !S3Fixtures.ready()) throw new Error("build/esp32sim.wasm, build/roms and build/samples are required: run pnpm engine:build, pnpm fetch:roms and sh tools/build-samples.sh");
  }
}

RequireBuiltArtifacts.assertPresent();
