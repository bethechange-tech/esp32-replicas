import type { FileSource } from "./privacy-scanner";
import { type EngineLockData, VendorLock } from "./vendor-lock";

const VENDORED_PREFIX = "third_party/esp32sim/";

/**
 * Hides the vendored files that are upstream's, byte for byte, by engine.lock: they are public by construction (the
 * upstream project publishes them), so only files this project wrote or changed are read for private data. A vendored
 * file that differs from the lock is not hidden, and neither is a file the lock does not name.
 */
export class LockedUpstreamSource implements FileSource {
  constructor(
    private readonly inner: FileSource,
    private readonly lock: EngineLockData,
  ) {}

  list(): string[] {
    return this.inner.list().filter((file) => !this.isUpstream(file));
  }

  read(relative: string): Buffer {
    return this.inner.read(relative);
  }

  /** How many files the lock lets this source hide, so a test can assert the filter did something. */
  hiddenCount(): number {
    return this.inner.list().filter((file) => this.isUpstream(file)).length;
  }

  private isUpstream(file: string): boolean {
    if (!file.startsWith(VENDORED_PREFIX)) return false;
    const expected = this.lock.files[file.slice(VENDORED_PREFIX.length)];
    return expected !== undefined && VendorLock.digestOf(this.inner.read(file)) === expected;
  }
}
