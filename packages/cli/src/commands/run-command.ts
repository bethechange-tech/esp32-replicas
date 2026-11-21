import type { BoardId, FirmwareSource, FlashImage, Output, WifiSpec } from "@replicas/core";
import { FlashImageRefused } from "@replicas/firmware";
import type { BoardRun } from "../board-run";
import type { RunArguments } from "../run-arguments";

const MILLISECONDS_PER_SECOND = 1000;
export const EXIT_OK = 0;
export const EXIT_REFUSED = 2;

export class BoardNotAvailable extends Error {
  constructor(board: BoardId) {
    super(`the replica ${board} is not built yet`);
  }
}

export interface ImageSources {
  at(path: string): FirmwareSource;
}

export interface BoardSession {
  readonly run: BoardRun;
  close(): Promise<void>;
}

export interface BoardSessions {
  open(args: { board: BoardId; mappedNames: readonly string[]; wifi: WifiSpec }): Promise<BoardSession>;
}

/** `replica run`: checks the image, boots it on the board, runs the emulated seconds given and prints the console. Refusals are named and happen before boot. */
export class RunCommand {
  constructor(
    private readonly parts: {
      readonly images: ImageSources;
      readonly sessions: BoardSessions;
      readonly output: Output;
    },
  ) {}

  async execute(args: RunArguments): Promise<number> {
    let image: FlashImage;
    try {
      image = await this.parts.images.at(args.image).image(args.board);
    } catch (error) {
      if (error instanceof FlashImageRefused) return this.refuse(`image refused: ${error.refusal}`);
      throw error;
    }
    let session: BoardSession;
    try {
      session = await this.parts.sessions.open({ board: args.board, mappedNames: args.mappedNames, wifi: args.wifi });
    } catch (error) {
      if (error instanceof BoardNotAvailable) return this.refuse(error.message);
      throw error;
    }
    try {
      await session.run.start({ image, wifiAccessPoint: args.wifi, flashWrites: [] });
      await session.run.runFor(args.seconds * MILLISECONDS_PER_SECOND);
      this.parts.output.write(session.run.console());
      return EXIT_OK;
    } finally {
      await session.close();
    }
  }

  private refuse(message: string): number {
    this.parts.output.write(`${message}\n`);
    return EXIT_REFUSED;
  }
}
