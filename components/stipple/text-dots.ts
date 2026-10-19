// Stippled type in a page (the About paragraph, the Photography caption). The
// words are laid out by the DOM (real, selectable text in Fredoka, made
// transparent once the dots are in), then read back here (where each run
// starts, where its baseline sits, its font) and painted into a mask that the
// home page's shader inflates, lights and dots (stipple.ts finishName, in the
// build worker).
//
// Markup: an element with [data-run] whose first child is its text, and a
// zero-size inline-block [data-baseline] probe after it, whose top is the
// text's baseline. Runs inside a link get a stippled underline.

import { PALETTE } from "./palette";
import type { Dots } from "./stage";
import { type Mask, type NameJob, type StippleTargets } from "./stipple";

export type { Dots };

/** One run of text as the DOM set it, in the stipple canvas's CSS px. */
export interface Run {
  text: string;
  px: number;
  /** Pen position (the text's start) and baseline. */
  x: number;
  baseline: number;
  font: string;
  /** Inside a link: underlined. */
  link: boolean;
}

// Room around the ink for the inflated forms and their spray, in font sizes.
const PAD = 0.24;
// A link's underline: how far below the baseline, and how thick (in font sizes).
const UNDERLINE_Y = 0.16;
const UNDERLINE_H = 0.055;

/** Every [data-run] in `root`, relative to (originX, originY) in client px. */
export function readRuns(root: HTMLElement, originX: number, originY: number): Run[] {
  const runs: Run[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-run]"))) {
    const node = el.firstChild;
    const probe = el.querySelector<HTMLElement>("[data-baseline]");
    const text = node?.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").trim() : "";
    if (!node || !probe || !text) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const start = range.getBoundingClientRect().left;
    const style = getComputedStyle(el);
    const px = parseFloat(style.fontSize);
    runs.push({
      text,
      px,
      x: start - originX,
      baseline: probe.getBoundingClientRect().top - originY,
      font: `${style.fontWeight} ${px}px ${style.fontFamily}`,
      link: el.closest("a") !== null,
    });
  }
  return runs;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) throw new Error("2D canvas unavailable");
  return measureCtx;
}

/** A run's ink box, its underline included. */
function inkOf(run: Run): Box {
  const ctx = measurer();
  ctx.font = run.font;
  const m = ctx.measureText(run.text);
  const under = run.link ? run.px * (UNDERLINE_Y + UNDERLINE_H) : 0;
  return {
    left: run.x - m.actualBoundingBoxLeft,
    right: run.x + m.actualBoundingBoxRight,
    top: run.baseline - m.actualBoundingBoxAscent,
    bottom: run.baseline + Math.max(m.actualBoundingBoxDescent, under),
  };
}

function union(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** Paints into a mask covering `box` (CSS px) at no more than `budget` pixels. */
function paintMask(box: Box, budget: number, paint: (ctx: CanvasRenderingContext2D) => void): Mask {
  const cssW = Math.max(1, box.right - box.left);
  const cssH = Math.max(1, box.bottom - box.top);
  const scale = Math.min(2, Math.sqrt(budget / (cssW * cssH)));
  const w = Math.max(4, Math.ceil(cssW * scale));
  const h = Math.max(4, Math.ceil(cssH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.scale(scale, scale);
  ctx.translate(-box.left, -box.top);
  ctx.fillStyle = "#fff";
  paint(ctx);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const coverage = new Float32Array(w * h);
  for (let i = 0; i < coverage.length; i++) coverage[i] = pixels[i * 4 + 3] / 255;
  return { coverage, w, h, scale, x: box.left, y: box.top };
}

/** A stable seed from a string (FNV-1a). */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export interface JobOptions {
  /** Canvas width (CSS px). */
  width: number;
  maxDots: number;
  /** Mask budget, in pixels. */
  maskPixels: number;
}

/** A stipple job for runs of one size, shaded as one mask. */
export function stippleJob(runs: Run[], opts: JobOptions): NameJob | null {
  if (!runs.length) return null;
  const px = runs[0].px;
  const ink = union(runs.map(inkOf));
  const pad = px * PAD;
  const box = { left: ink.left - pad, top: ink.top - pad, right: ink.right + pad, bottom: ink.bottom + pad };
  const mask = paintMask(box, opts.maskPixels, (ctx) => {
    ctx.textBaseline = "alphabetic";
    for (const run of runs) {
      ctx.font = run.font;
      ctx.fillText(run.text, run.x, run.baseline);
      if (!run.link) continue;
      const m = ctx.measureText(run.text);
      const left = run.x - m.actualBoundingBoxLeft;
      ctx.fillRect(left, run.baseline + px * UNDERLINE_Y, m.actualBoundingBoxRight - left + run.x, px * UNDERLINE_H);
    }
  });
  const width = ink.right - ink.left;
  return {
    name: mask,
    icons: null,
    decor: [],
    iconRects: [],
    width: opts.width,
    maxParticles: opts.maxDots,
    blockWidth: width,
    blockHeight: ink.bottom - ink.top,
    basis: {
      fontFamily: runs[0].font.replace(/^\S+\s+\S+\s+/, ""),
      fontWeight: 700,
      fontPx: px,
      stacked: false,
      maxWidth: width,
      align: "left",
      left: ink.left,
      centerX: (ink.left + ink.right) / 2,
      centerY: (ink.top + ink.bottom) / 2,
      glow: PALETTE.glow,
      seed: seedOf(runs.map((r) => r.text).join(" ")),
    },
  };
}

/** The runs set k times larger (to be shaded large, then shrunk with shrinkDots). */
export function scaleRuns(runs: Run[], k: number): Run[] {
  return runs.map((r) => ({
    ...r,
    px: r.px * k,
    x: r.x * k,
    baseline: r.baseline * k,
    font: r.font.replace(/\d+(\.\d+)?px/, `${r.px * k}px`),
  }));
}

// Shrunk dots keep a little more than their scaled-down size (but stay fine,
// so small words keep their counters open).
const SHRINK_DOTS = 0.7;

/**
 * Scales dots shaded k times too large back down, in place: a dense
 * miniature whose dots stay fine, where shading small type directly gives a
 * few coarse dots on a thin shape.
 */
export function shrinkDots(dots: Dots, k: number): Dots {
  if (k <= 1) return dots;
  const grow = Math.pow(1 / k, SHRINK_DOTS);
  for (let i = 0; i < dots.count; i++) {
    dots.home[i * 2] /= k;
    dots.home[i * 2 + 1] /= k;
    dots.attrs[i * 2] *= grow;
  }
  return dots;
}

/** Every dot's final home and look. */
export function dotsOf(targets: StippleTargets): Dots {
  return { count: targets.count, home: targets.home, attrs: targets.attrs };
}

/** Waits for the Fredoka face (or its failure: the fallback still reads). */
export function fontsReady(font: string): Promise<void> {
  return document.fonts.load(font).then(
    () => {},
    () => {},
  );
}
