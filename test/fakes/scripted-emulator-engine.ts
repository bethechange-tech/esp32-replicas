import { EngineNotCreated, type BoardDeclaration, type EmulatorEngine, type EngineInput, type FlashImage, type Observation, type Slice } from "@replicas/core";

/** An engine that plays a fixed console script, one chunk per run slice, and records what it was asked to do. */
export class ScriptedEmulatorEngine implements EmulatorEngine {
  readonly calls: string[] = [];
  readonly inputs: EngineInput[] = [];
  private created = false;
  private nextChunk = 0;
  private pending = "";

  constructor(private readonly script: readonly string[]) {}

  async create(declaration: BoardDeclaration): Promise<void> {
    this.calls.push(`create ${declaration.chip}`);
    this.created = true;
  }

  destroy(): void {
    this.calls.push("destroy");
    this.created = false;
    this.pending = "";
  }

  load(image: FlashImage): void {
    this.require();
    this.calls.push(`load ${image.offset} ${image.bytes.length}`);
  }

  boot(): void {
    this.require();
    this.calls.push("boot");
  }

  run(slice: Slice): void {
    this.require();
    this.calls.push(`run ${slice.cycles}`);
    this.pending += this.script[this.nextChunk] ?? "";
    this.nextChunk += 1;
  }

  sendInput(input: EngineInput): void {
    this.require();
    this.inputs.push(input);
  }

  takeOutput(): Observation {
    this.require();
    const console = this.pending;
    this.pending = "";
    return { console, frames: [], gpioEdges: [] };
  }

  private require(): void {
    if (!this.created) throw new EngineNotCreated();
  }
}
