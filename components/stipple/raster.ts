// Lays out the name, icon row and titles, and paints them into masks for
// stipple.ts to shade. Only this part needs the DOM (fonts, canvas text); the
// heavy shading runs wherever the masks are sent.

import { paintGlyph, type GlyphId } from "./glyphs";
import { PALETTE } from "./palette";
import type { Mask, NameBasis, NameJob, Rect, TitleJob } from "./stipple";

/** A rectangle in CSS px. */
export interface Area {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StippleOptions {
  lines: string[];
  fontFamily: string;
  fontWeight?: string | number;
  /** Icons drawn in a row under the name, in the same stipple. */
  icons?: GlyphId[];
  /** Words set before the name's first line (optional) and after its last (e.g. "?"). */
  decor?: { before?: string; after: string };
  width: number;
  height: number;
  /**
   * Where the name, decoration and icons must fit (defaults to the whole
   * viewport, centred a little above the middle), and how to align them.
   */
  area?: Area;
  align?: "left" | "center";
  maxParticles: number;
  seed?: number;
  /** Dots are light on a dark ground, so lit faces gather them. Defaults to the palette's. */
  glow?: boolean;
}

/** The portrait's frame, width to height. */
export const PORTRAIT_ASPECT = 0.8;

/**
 * The home page's split: on wide screens the name sits on the left with the
 * portrait on the right; on narrow ones the portrait sits above it.
 */
export interface HomeLayout {
  /** Side by side (else stacked, the portrait on top). */
  split: boolean;
  name: Area;
  portrait: Area;
}

export function homeLayout(W: number, H: number): HomeLayout {
  if (W >= 820 && W / H >= 1.05) {
    const h = Math.min(H * 0.78, (W * 0.38) / PORTRAIT_ASPECT);
    const w = h * PORTRAIT_ASPECT;
    return {
      split: true,
      name: { left: W * 0.06, top: H * 0.06, width: W * 0.45, height: H * 0.88 },
      portrait: { left: W * 0.765 - w / 2, top: H * 0.5 - h / 2, width: w, height: h },
    };
  }
  const h = Math.min(H * 0.44, (W * 0.84) / PORTRAIT_ASPECT);
  const w = h * PORTRAIT_ASPECT;
  return {
    split: false,
    name: { left: W * 0.04, top: H * 0.5, width: W * 0.92, height: H * 0.46 },
    portrait: { left: (W - w) / 2, top: H * 0.27 - h / 2, width: w, height: h },
  };
}

// Keep masks small enough that the distance transforms stay fast.
const NAME_MASK_PIXELS = 320_000;
const ICON_MASK_PIXELS = NAME_MASK_PIXELS / 3;
const TITLE_MASK_PIXELS = 200_000;
const DECOR_MASK_PIXELS = 140_000;
// The decoration: "before" is set small, "after" at the name's size, both on
// their line's baseline; the name itself never moves. Sizes shrink to keep
// clear of the edges, and "before" moves above the first line if it can't fit
// (space for it is kept above the name, so nothing is cut off).
const DECOR_BEFORE_SIZE = 0.45; // of the name's font size
const DECOR_GAP = 0.32; // between the words and the name, in their font size
const DECOR_MARGIN = 0.03; // of the viewport width, kept clear at the sides
const DECOR_MIN_SIZE = 0.28; // smallest either word may shrink to, of the name's size
// Icon row, relative to the name's font size (default layout / within an area).
const ICON_SIZE = 0.5;
const AREA_ICON_SIZE = 0.56;
const ICON_MIN_PX = 40;
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

/** Left edge of a line inside a block of `blockWidth`, for the alignment. */
function lineOffset(blockWidth: number, lineWidth: number, align: "left" | "center"): number {
  return align === "left" ? 0 : (blockWidth - lineWidth) / 2;
}

/** Paints lines of text in white, with the block's top-left at (pad, pad). */
function paintLines(
  ctx: CanvasRenderingContext2D,
  font: string,
  lines: string[],
  metrics: TextMetrics[],
  blockWidth: number,
  lineGap: number,
  pad: number,
  align: "left" | "center",
): void {
  ctx.fillStyle = "#fff";
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  let y = pad;
  lines.forEach((line, i) => {
    const m = metrics[i];
    const lineWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    ctx.fillText(line, pad + lineOffset(blockWidth, lineWidth, align) + m.actualBoundingBoxLeft, y + m.actualBoundingBoxAscent);
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
  const area = opts.area;
  const align = opts.align ?? "center";
  const measure = measurer();
  // Two chunky lines read far better as stipple; only ultra-wide spaces get one.
  const stacked = area ? area.width / area.height < 2.1 : W / H < 2.1;
  const lines = stacked ? opts.lines : [opts.lines.join(" ")];
  measure.font = `${fontWeight} 100px ${fontFamily}`;
  // In an area, the "after" word must fit beside the last line at full size.
  let after = 0;
  if (area && opts.decor?.after) {
    const m = measure.measureText(opts.decor.after);
    after = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + 100 * DECOR_GAP * 0.4;
  }
  let widest = 0;
  lines.forEach((line, i) => {
    const m = measure.measureText(line);
    widest = Math.max(widest, m.actualBoundingBoxLeft + m.actualBoundingBoxRight + (i === lines.length - 1 ? after : 0));
  });
  const maxWidth = area ? area.width * (after ? 0.97 : 0.9) : W * (W < 600 ? 0.84 : 0.68);
  const maxLineHeight = area
    ? (area.height * 0.38) / lines.length
    : // Cap height so the block leaves room below.
      (H * (stacked ? 0.5 : 0.34)) / lines.length;
  const fontPx = Math.min((maxWidth / widest) * 100, maxLineHeight / 0.78);
  if (!(W > 0 && H > 0 && fontPx > 0 && Number.isFinite(fontPx))) return null;
  const lineGap = fontPx * 0.1;
  const icons = opts.icons ?? [];

  // Measure each line at the final size to size the mask tightly.
  const font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  measure.font = font;
  const metrics = lines.map((line) => measure.measureText(line));
  const blockWidth = Math.max(...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight));
  const blockHeight =
    metrics.reduce((sum, m) => sum + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 0) +
    lineGap * (lines.length - 1);

  // The name and the icon row are placed together as one block.
  const iconPx = Math.max(ICON_MIN_PX, fontPx * (area ? AREA_ICON_SIZE : ICON_SIZE));
  const iconGap = iconPx * ICON_GAP;
  const rowWidth = icons.length * iconPx + Math.max(0, icons.length - 1) * iconGap;
  const rowSpace = icons.length ? fontPx * ICON_SPACE : 0;
  // Centre the name together with its "after" word, so the word always fits.
  const lastMetrics = metrics[metrics.length - 1];
  const spanWidth = Math.max(blockWidth, lastMetrics.actualBoundingBoxLeft + lastMetrics.actualBoundingBoxRight + (after * fontPx) / 100);
  const nameLeft = area ? area.left + (align === "left" ? 0 : (area.width - spanWidth) / 2) : (W - blockWidth) / 2;
  const decorAt = (top: number) =>
    opts.decor
      ? layoutDecor(opts.decor, measure, fontFamily, fontWeight, fontPx, metrics, nameLeft, top, blockWidth, lineGap, W, align, area)
      : [];
  // Keep room above the name for decoration that sits over its first line.
  const above = Math.max(0, ...decorAt(0).map((word) => -word.top));
  const totalHeight = above + blockHeight + (icons.length ? rowSpace + iconPx : 0);
  const centerY = area ? area.top + area.height / 2 : H * 0.45;
  const nameTop = centerY - totalHeight / 2 + above;

  const pad = fontPx * 0.18;
  const name = rasterize(blockWidth + pad * 2, blockHeight + pad * 2, nameLeft - pad, nameTop - pad, NAME_MASK_PIXELS, (ctx) =>
    paintLines(ctx, font, lines, metrics, blockWidth, lineGap, pad, align),
  );

  const iconRects: Rect[] = [];
  let iconMask: Mask | null = null;
  if (icons.length) {
    const rowLeft = area && align === "left" ? nameLeft : area ? area.left + (area.width - rowWidth) / 2 : (W - rowWidth) / 2;
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
    decor: paintDecor(decorAt(nameTop), measure, fontFamily, fontWeight),
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
      align,
      left: nameLeft,
      centerX: nameLeft + blockWidth / 2,
      centerY: nameTop + blockHeight / 2,
      glow: opts.glow ?? PALETTE.glow,
      seed: opts.seed ?? 0x5eed,
    },
  };
}

interface DecorWord {
  text: string;
  px: number;
  x: number;
  baseline: number;
  /** Top of the word's ink, in CSS px. */
  top: number;
}

/** Places the decoration words around the name's lines (the name's top at `nameTop`). */
function layoutDecor(
  decor: { before?: string; after: string },
  measure: CanvasRenderingContext2D,
  fontFamily: string,
  fontWeight: string | number,
  fontPx: number,
  metrics: TextMetrics[],
  nameLeft: number,
  nameTop: number,
  blockWidth: number,
  lineGap: number,
  W: number,
  align: "left" | "center",
  area?: Area,
): DecorWord[] {
  // Where the name's first and last lines sit (left edge, right edge, baseline, top).
  const placed = metrics.map((m, i) => {
    const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    let top = nameTop;
    for (let k = 0; k < i; k++) top += metrics[k].actualBoundingBoxAscent + metrics[k].actualBoundingBoxDescent + lineGap;
    const left = nameLeft + lineOffset(blockWidth, width, align);
    return { left, right: left + width, baseline: top + m.actualBoundingBoxAscent, top };
  });
  const first = placed[0];
  const last = placed[placed.length - 1];
  const margin = W * DECOR_MARGIN;
  const widthAt = (text: string, px: number) => {
    measure.font = `${fontWeight} ${px}px ${fontFamily}`;
    const m = measure.measureText(text);
    return { width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent };
  };
  const words: DecorWord[] = [];

  // "before": to the left of the first line, or above it if there's no room.
  if (decor.before) {
    let px = fontPx * DECOR_BEFORE_SIZE;
    let { width, ascent } = widthAt(decor.before, px);
    const room = first.left - margin - px * DECOR_GAP;
    if (width <= room) {
      const x = first.left - px * DECOR_GAP - width;
      words.push({ text: decor.before, px, x, baseline: first.baseline, top: first.baseline - ascent });
    } else {
      px = Math.max(fontPx * DECOR_MIN_SIZE, Math.min(px, (px * (W - 2 * margin)) / width));
      ({ width, ascent } = widthAt(decor.before, px));
      const baseline = first.top - px * DECOR_GAP;
      words.push({ text: decor.before, px, x: Math.max(margin, first.left), baseline, top: baseline - ascent });
    }
  }
  // "after": just after the last line, shrunk if it would run off the edge.
  if (decor.after) {
    let px = fontPx;
    let { width, ascent } = widthAt(decor.after, px);
    const gap = () => px * DECOR_GAP * 0.4;
    const room = (area ? Math.min(W - margin, area.left + area.width) : W - margin) - last.right;
    if (width + gap() > room) {
      px = Math.max(fontPx * DECOR_MIN_SIZE, (px * room) / (width + gap()));
      ({ width, ascent } = widthAt(decor.after, px));
    }
    words.push({ text: decor.after, px, x: last.right + gap(), baseline: last.baseline, top: last.baseline - ascent });
  }
  return words;
}

/** Paints each decoration word into its own mask, so each is shaded for its own size. */
function paintDecor(
  words: DecorWord[],
  measure: CanvasRenderingContext2D,
  fontFamily: string,
  fontWeight: string | number,
): Mask[] {
  return words.map((word) => {
    const font = `${fontWeight} ${word.px}px ${fontFamily}`;
    measure.font = font;
    const m = measure.measureText(word.text);
    const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const pad = word.px * 0.18;
    const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + pad * 2;
    return rasterize(width + pad * 2, height, word.x - pad, word.top - pad, DECOR_MASK_PIXELS / words.length, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "alphabetic";
      ctx.font = font;
      ctx.fillText(word.text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
    });
  });
}

/**
 * Sets a title in the name's place, at the name's size (smaller if it would
 * be too wide), aligned like the name, and paints it into a mask.
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
  const left = basis.align === "left" ? basis.left : basis.centerX - blockWidth / 2;
  const mask = rasterize(
    blockWidth + pad * 2,
    blockHeight + pad * 2,
    left - pad,
    basis.centerY - blockHeight / 2 - pad,
    TITLE_MASK_PIXELS,
    (ctx) => paintLines(ctx, font, lines, metrics, blockWidth, lineGap, pad, basis.align),
  );
  return { index, mask, fontPx };
}
