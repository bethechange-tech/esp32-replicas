import type { LcdFrame } from "@replicas/core";

const BYTES_PER_PIXEL = 2;

export interface RgbFrameGeometry {
  readonly columns: number;
  readonly rows: number;
}

/**
 * A parallel RGB panel: it has no memory of its own, so what it shows is the latest whole frame the chip's LCD_CAM peripheral scanned out.
 * The engine hands over the frame as the firmware's framebuffer holds it, big-endian RGB565; a frame of any other size is dropped and counted.
 */
export class RgbFrame {
  private latestFrame: LcdFrame | undefined;
  private accepted = 0;
  private refused = 0;

  constructor(private readonly geometry: RgbFrameGeometry) {}

  receive(frame: LcdFrame): void {
    const expectedBytes = this.geometry.columns * this.geometry.rows * BYTES_PER_PIXEL;
    if (frame.width !== this.geometry.columns || frame.height !== this.geometry.rows || frame.rgb565.length !== expectedBytes) {
      this.refused += 1;
      return;
    }
    this.latestFrame = { width: frame.width, height: frame.height, rgb565: Uint8Array.from(frame.rgb565) };
    this.accepted += 1;
  }

  /** The latest whole frame, or undefined until one has been scanned out. */
  latest(): LcdFrame | undefined {
    return this.latestFrame;
  }

  /** What the glass shows with nothing lit behind it: every pixel black. */
  dark(): LcdFrame {
    return { width: this.geometry.columns, height: this.geometry.rows, rgb565: new Uint8Array(this.geometry.columns * this.geometry.rows * BYTES_PER_PIXEL) };
  }

  framesAccepted(): number {
    return this.accepted;
  }

  framesRefused(): number {
    return this.refused;
  }
}
