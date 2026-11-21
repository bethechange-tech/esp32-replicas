export interface Offence {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

/** What a scan read as well as what it found: a break that changes nothing the guard reads proves nothing. */
export interface GuardReport {
  readonly filesRead: readonly string[];
  /** Files that exist but were not scanned (too large, or binary). Never counted as read. */
  readonly filesSkipped: readonly string[];
  readonly offences: readonly Offence[];
}

export class ReportBuilder {
  private readonly files = new Set<string>();
  private readonly skipped = new Set<string>();
  private readonly found: Offence[] = [];

  read(file: string): void {
    this.files.add(file);
  }

  skip(file: string): void {
    this.files.delete(file);
    this.skipped.add(file);
  }

  offend(offence: Offence): void {
    this.found.push(offence);
  }

  addAll(offences: readonly Offence[]): void {
    this.found.push(...offences);
  }

  build(): GuardReport {
    return { filesRead: [...this.files].sort(), filesSkipped: [...this.skipped].sort(), offences: this.found };
  }
}

export interface Sanction {
  readonly file: string;
  readonly name: string;
  readonly reason: string;
}

/** A sanction that matches nothing is an offence: an exception nobody uses is a hole nobody sees. */
export class SanctionLedger {
  private readonly used = new Set<Sanction>();

  constructor(private readonly sanctions: readonly Sanction[]) {}

  covers(subject: { file: string; name: string }): boolean {
    return this.find(subject) !== undefined;
  }

  /** Records that a sanction was needed, so that it is not reported as stale. */
  claim(subject: { file: string; name: string }): void {
    const match = this.find(subject);
    if (match) this.used.add(match);
  }

  private find(subject: { file: string; name: string }): Sanction | undefined {
    return this.sanctions.find((s) => s.file === subject.file && s.name === subject.name);
  }

  stale(rule: string): Offence[] {
    return this.sanctions
      .filter((s) => !this.used.has(s))
      .map((s) => ({
        file: s.file,
        line: 0,
        rule,
        message: `sanction for "${s.name}" matches nothing`,
      }));
  }
}
