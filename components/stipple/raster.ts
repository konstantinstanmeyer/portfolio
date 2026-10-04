// Lays out the name, icon row and titles, and paints them into masks for
// stipple.ts to shade. Only this part needs the DOM (fonts, canvas text); the
// heavy shading runs wherever the masks are sent.

import { paintGlyph, type GlyphId } from "./glyphs";
import { PALETTE } from "./palette";
import type { Mask, NameBasis, NameJob, Rect, TitleJob } from "./stipple";

export interface StippleOptions {
  lines: string[];
  fontFamily: string;
  fontWeight?: string | number;
  /** Icons drawn in a row under the name, in the same stipple. */
  icons?: GlyphId[];
  width: number;
  height: number;
  maxParticles: number;
  seed?: number;
  /** Dots are light on a dark ground, so lit faces gather them. Defaults to the palette's. */
  glow?: boolean;
}

// Keep masks small enough that the distance transforms stay fast.
const NAME_MASK_PIXELS = 320_000;
const ICON_MASK_PIXELS = NAME_MASK_PIXELS / 3;
const TITLE_MASK_PIXELS = 200_000;
// Icon row, relative to the name's font size.
const ICON_SIZE = 0.5;
const ICON_MIN_PX = 44;
const ICON_GAP = 0.7; // between icons, in icon sizes
const ICON_SPACE = 0.42; // between the name and the row, in font sizes

/** Paints a shape (white on transparent) into a mask of at most `budget` pixels. */
function rasterize(
  cssW: number,
  cssH: number,
  x: number,
  y: number,
  budget: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Mask {
  const scale = Math.min(1.5, Math.sqrt(budget / (cssW * cssH)));
  const w = Math.ceil(cssW * scale);
  const h = Math.ceil(cssH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.scale(scale, scale);
  paint(ctx);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const coverage = new Float32Array(w * h);
  for (let i = 0; i < coverage.length; i++) coverage[i] = pixels[i * 4 + 3] / 255;
  return { coverage, w, h, scale, x, y };
}

/** Paints centred lines of text in white, with the block's top-left at (pad, pad). */
function paintLines(
  ctx: CanvasRenderingContext2D,
  font: string,
  lines: string[],
  metrics: TextMetrics[],
  blockWidth: number,
  lineGap: number,
  pad: number,
): void {
  ctx.fillStyle = "#fff";
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  let y = pad;
  lines.forEach((line, i) => {
    const m = metrics[i];
    const lineWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    ctx.fillText(line, pad + (blockWidth - lineWidth) / 2 + m.actualBoundingBoxLeft, y + m.actualBoundingBoxAscent);
    y += m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + lineGap;
  });
}

function measurer(): CanvasRenderingContext2D {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return ctx;
}

/** Lays out and paints the name and icon row; null when there's no room to draw. */
export function prepareName(opts: StippleOptions): NameJob | null {
  const { width: W, height: H, fontFamily } = opts;
  const fontWeight = opts.fontWeight ?? 400;
  const measure = measurer();
  // Two chunky lines read far better as stipple; only ultra-wide screens get one.
  const stacked = W / H < 2.1;
  const lines = stacked ? opts.lines : [opts.lines.join(" ")];
  measure.font = `${fontWeight} 100px ${fontFamily}`;
  let widest = 0;
  for (const line of lines) {
    const m = measure.measureText(line);
    widest = Math.max(widest, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  }
  const maxWidth = W * (W < 600 ? 0.84 : 0.68);
  // Cap height so the block leaves room for the message box below.
  const maxLineHeight = (H * (stacked ? 0.5 : 0.34)) / lines.length;
  const fontPx = Math.min((maxWidth / widest) * 100, maxLineHeight / 0.78);
  if (!(W > 0 && H > 0 && fontPx > 0 && Number.isFinite(fontPx))) return null;
  const lineGap = fontPx * 0.1;
  const centerY = H * 0.45;
  const icons = opts.icons ?? [];

  // Measure each line at the final size to size the mask tightly.
  const font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  measure.font = font;
  const metrics = lines.map((line) => measure.measureText(line));
  const blockWidth = Math.max(...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight));
  const blockHeight =
    metrics.reduce((sum, m) => sum + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 0) +
    lineGap * (lines.length - 1);

  // The name and the icon row are centred together as one block.
  const iconPx = Math.max(ICON_MIN_PX, fontPx * ICON_SIZE);
  const iconGap = iconPx * ICON_GAP;
  const rowWidth = icons.length * iconPx + Math.max(0, icons.length - 1) * iconGap;
  const rowSpace = icons.length ? fontPx * ICON_SPACE : 0;
  const totalHeight = blockHeight + (icons.length ? rowSpace + iconPx : 0);
  const nameTop = centerY - totalHeight / 2;
  const nameLeft = (W - blockWidth) / 2;

  const pad = fontPx * 0.18;
  const name = rasterize(blockWidth + pad * 2, blockHeight + pad * 2, nameLeft - pad, nameTop - pad, NAME_MASK_PIXELS, (ctx) =>
    paintLines(ctx, font, lines, metrics, blockWidth, lineGap, pad),
  );

  const iconRects: Rect[] = [];
  let iconMask: Mask | null = null;
  if (icons.length) {
    const rowLeft = (W - rowWidth) / 2;
    const rowTop = nameTop + blockHeight + rowSpace;
    const iconPad = iconPx * 0.25;
    icons.forEach((_, i) => {
      iconRects.push({ left: rowLeft + i * (iconPx + iconGap), top: rowTop, width: iconPx, height: iconPx });
    });
    iconMask = rasterize(rowWidth + iconPad * 2, iconPx + iconPad * 2, rowLeft - iconPad, rowTop - iconPad, ICON_MASK_PIXELS, (ctx) =>
      icons.forEach((id, i) => paintGlyph(ctx, id, iconPad + i * (iconPx + iconGap), iconPad, iconPx)),
    );
  }

  return {
    name,
    icons: iconMask,
    iconRects,
    width: W,
    maxParticles: opts.maxParticles,
    blockWidth,
    blockHeight,
    basis: {
      fontFamily,
      fontWeight,
      fontPx,
      stacked,
      maxWidth,
      centerX: nameLeft + blockWidth / 2,
      centerY: nameTop + blockHeight / 2,
      glow: opts.glow ?? PALETTE.glow,
      seed: opts.seed ?? 0x5eed,
    },
  };
}

/**
 * Sets a title in the name's place, at the name's size (smaller if it would
 * be too wide), and paints it into a mask.
 */
export function prepareTitle(basis: NameBasis, titleLines: string[], index: number): TitleJob {
  const measure = measurer();
  const lines = basis.stacked ? titleLines : [titleLines.join(" ")];
  measure.font = `${basis.fontWeight} 100px ${basis.fontFamily}`;
  let widest = 0;
  for (const line of lines) {
    const m = measure.measureText(line);
    widest = Math.max(widest, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  }
  const fontPx = Math.min(basis.fontPx, (basis.maxWidth / widest) * 100);
  const font = `${basis.fontWeight} ${fontPx}px ${basis.fontFamily}`;
  measure.font = font;
  const metrics = lines.map((line) => measure.measureText(line));
  const blockWidth = Math.max(...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight));
  const lineGap = fontPx * 0.1;
  const blockHeight =
    metrics.reduce((sum, m) => sum + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 0) +
    lineGap * (lines.length - 1);
  const pad = fontPx * 0.18;
  const mask = rasterize(
    blockWidth + pad * 2,
    blockHeight + pad * 2,
    basis.centerX - blockWidth / 2 - pad,
    basis.centerY - blockHeight / 2 - pad,
    TITLE_MASK_PIXELS,
    (ctx) => paintLines(ctx, font, lines, metrics, blockWidth, lineGap, pad),
  );
  return { index, mask, fontPx };
}
