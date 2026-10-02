import {
  BASE,
  BASE_Y,
  CARET_CELL,
  CELL,
  CELLS,
  FONT_WEIGHT,
  SDF_SPREAD,
  TRACKING,
} from "./constants";
import { blur, FieldScratch, signedField } from "./sdf";

export type CellSink = (cell: number, pixels: Uint8Array) => void;

/**
 * Bakes glyphs on demand into RGBA cells:
 * R = signed distance, G = tight halo, B = wide bloom, A = soft (reflection).
 * Keeps the pixels so the texture can be rebuilt after a lost context.
 */
export class GlyphAtlas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch = new FieldScratch(CELL);
  private readonly sdf = new Float32Array(CELL * CELL);
  private readonly halo = new Float32Array(CELL * CELL);
  private readonly bloom = new Float32Array(CELL * CELL);
  private readonly soft = new Float32Array(CELL * CELL);
  private readonly cells = new Map<string, number>();
  private readonly pixels: (Uint8Array | null)[] = new Array<Uint8Array | null>(CELLS).fill(null);
  private readonly advances = new Map<string, number>();
  private readonly kerns = new Map<string, number>();
  private next = 1;
  private font = "";

  constructor(
    family: string,
    private readonly sink: CellSink,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = CELL;
    this.canvas.height = CELL;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.setFamily(family);
  }

  /** Switch font (e.g. once the webfont has loaded); invalidates everything. */
  setFamily(family: string) {
    this.font = `${FONT_WEIGHT} ${BASE}px ${family}`;
    this.cells.clear();
    this.advances.clear();
    this.kerns.clear();
    this.pixels.fill(null);
    this.next = 1;
    this.store(CARET_CELL, this.raster(null));
  }

  /** Advance of a grapheme in ems, tracking included. */
  advance(ch: string): number {
    let a = this.advances.get(ch);
    if (a === undefined) {
      this.ctx.font = this.font;
      a = this.ctx.measureText(ch).width / BASE + TRACKING;
      this.advances.set(ch, a);
    }
    return a;
  }

  /** Pair kerning in ems. */
  kern(prev: string, ch: string): number {
    if (prev.length !== 1 || ch.length !== 1) return 0;
    const key = prev + ch;
    let k = this.kerns.get(key);
    if (k === undefined) {
      this.ctx.font = this.font;
      const pair = this.ctx.measureText(key).width / BASE;
      k = pair - (this.advance(prev) - TRACKING) - (this.advance(ch) - TRACKING);
      if (Math.abs(k) < 0.002) k = 0;
      this.kerns.set(key, k);
    }
    return k;
  }

  cellFor(ch: string): number {
    const hit = this.cells.get(ch);
    if (hit !== undefined) return hit;
    if (this.next >= CELLS) return -1;
    const cell = this.next++;
    this.cells.set(ch, cell);
    this.store(cell, this.raster(ch));
    return cell;
  }

  get full() {
    return this.next >= CELLS;
  }

  /** Re-send every baked cell (after a context restore). */
  replay() {
    for (let i = 0; i < CELLS; i++) {
      const p = this.pixels[i];
      if (p) this.sink(i, p);
    }
  }

  private store(cell: number, px: Uint8Array) {
    this.pixels[cell] = px;
    this.sink(cell, px);
  }

  private raster(ch: string | null): Uint8Array {
    const { ctx } = this;
    const mid = CELL / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CELL, CELL);
    ctx.fillStyle = "#fff";
    if (ch === null) {
      // The caret: a hairline bar from cap height to just below the baseline.
      const w = BASE * 0.036;
      ctx.fillRect(mid - w / 2, BASE_Y - BASE * 0.76, w, BASE * 0.82);
    } else {
      ctx.font = this.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const w = ctx.measureText(ch).width;
      const max = BASE * 1.3;
      if (w > max) {
        const k = max / w;
        ctx.setTransform(k, 0, 0, k, mid * (1 - k), BASE_Y * (1 - k));
      }
      ctx.fillText(ch, mid, BASE_Y);
    }
    const img = ctx.getImageData(0, 0, CELL, CELL).data;
    const a = this.scratch.a;
    for (let i = 0; i < a.length; i++) a[i] = img[i * 4 + 3] / 255;

    signedField(a, this.sdf, SDF_SPREAD, this.scratch);
    blur(a, this.halo, 2, this.scratch);
    blur(a, this.soft, 4, this.scratch);
    blur(a, this.bloom, 8, this.scratch);

    const out = new Uint8Array(CELL * CELL * 4);
    for (let i = 0, j = 0; i < a.length; i++, j += 4) {
      out[j] = this.sdf[i] * 255;
      out[j + 1] = Math.min(1, this.halo[i] * 2.2) * 255;
      out[j + 2] = Math.min(1, this.bloom[i] * 5.5) * 255;
      out[j + 3] = Math.min(1, this.soft[i] * 3.2) * 255;
    }
    return out;
  }
}
