// Turns a photograph into stipple dots: light dots on the night paper,
// gathered where the picture is bright and along its edges, so a frame reads
// like the stippled name rather than like a halftone.
//
// The source is just the photo in grayscale (public/portrait/portrait-tone.jpg is
// public/portrait/portrait.jpg converted to grayscale and resized to 480 px wide);
// all the tone work happens here: a levels stretch, local contrast at the
// scale of a hand or a face, an edge term, and a black point. The frame
// dissolves unevenly at its borders, like the stippled letters' edges.
//
// With a matte (an image whose alpha is the subject, cut from its background)
// only the subject gets dots: its tones are stretched over its own range, a
// rim of dots traces its outline, and a sparse fill keeps its darkest parts
// (hair against the night paper) from vanishing.

import type { Dots } from "./stage";
import { mulberry32 } from "./stipple";

export interface ImageDotOptions {
  width: number;
  height: number;
  /** object-position (0–1) of the cover crop, as in CSS. */
  posX: number;
  posY: number;
  /** Tone curve exponent: higher keeps mid-darks emptier. */
  gamma: number;
  /** Extra density along edges (0 = none). */
  edges: number;
  /** CSS px² of full-tone area per dot; lower is denser. */
  areaPerDot: number;
  maxDots: number;
  /** Dot diameter scale (CSS px). */
  dotSize: number;
  /** Dot opacity scale (clamped to fully opaque); 1 by default. */
  opacity?: number;
  /** The densest any spot gets (0–0.95, the default): lower keeps highlights from outshining other dots. */
  highlight?: number;
  /** How far in from the frame (share of the short side) the picture fades in. */
  feather: number;
  seed: number;
  /** The subject's matte (in its alpha), in register with the image. */
  matte?: HTMLImageElement;
  /** With a matte: density along the subject's outline. */
  rim?: number;
  /** With a matte: the least density anywhere inside the subject. */
  floor?: number;
  /** Pixels in the tone analysis grid (default 160k); more keeps finer detail for dense sets. */
  gridPixels?: number;
  /** Most analysis-grid pixels per CSS px (default 1.25); finer dots need a finer grid. */
  maxGridScale?: number;
}

// Keep the analysis grid small; the dots carry the detail.
const GRID_PIXELS = 160_000;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0, 1]. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const hash = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi) + (hash(xi + 1, yi) - hash(xi, yi)) * sx;
  const b = hash(xi, yi + 1) + (hash(xi + 1, yi + 1) - hash(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

/** Separable box blur into a new array (clamped edges). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / span;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function blur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius / Math.sqrt(2)));
  return boxBlur(boxBlur(src, w, h, r), w, h, r);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function imageDots(image: HTMLImageElement, o: ImageDotOptions): Dots {
  const scale = Math.min(o.maxGridScale ?? 1.25, Math.sqrt((o.gridPixels ?? GRID_PIXELS) / Math.max(1, o.width * o.height)));
  const w = Math.max(8, Math.round(o.width * scale));
  const h = Math.max(8, Math.round(o.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");

  // object-fit: cover, with object-position (posX, posY), exactly as CSS
  // would place the picture (and the matte, which shares its size).
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const cover = Math.max(w / iw, h / ih);
  const dw = iw * cover;
  const dh = ih * cover;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, (w - dw) * o.posX, (h - dh) * o.posY, dw, dh);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  const size = w * h;
  const lum = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const p = i * 4;
    lum[i] = (0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) / 255;
  }
  let matte: Float32Array | null = null;
  if (o.matte) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(o.matte, (w - dw) * o.posX, (h - dh) * o.posY, dw, dh);
    const alpha = ctx.getImageData(0, 0, w, h).data;
    matte = new Float32Array(size);
    for (let i = 0; i < size; i++) matte[i] = alpha[i * 4 + 3] / 255;
  }

  // Stretch to the picture's own range (the subject's, with a matte), ignoring stray extremes.
  const histogram = new Uint32Array(256);
  let counted = 0;
  for (let i = 0; i < size; i++) {
    if (matte && matte[i] < 0.5) continue;
    histogram[Math.min(255, (lum[i] * 255) | 0)]++;
    counted++;
  }
  const percentile = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += histogram[v];
      if (acc >= q * counted) return v / 255;
    }
    return 1;
  };
  const lo = percentile(0.02);
  const hi = Math.max(lo + 0.05, percentile(0.996));
  for (let i = 0; i < size; i++) lum[i] = Math.min(1, Math.max(0, (lum[i] - lo) / (hi - lo)));

  // Local contrast (an unsharp mask at the scale of a hand or a face), so
  // forms separate from what's behind them, and a fine edge term.
  const short = Math.min(w, h);
  const broad = blur(lum, w, h, short * 0.05);
  const fine = blur(lum, w, h, 1.1);
  const feather = Math.max(2, short * o.feather);
  const blotch = 1 / (short * 0.09);
  // A band just inside the matte's edge: the matte less a blurred copy of itself.
  const rimBand = matte && o.rim ? blur(matte, w, h, short * 0.018) : null;
  const density = new Float32Array(size);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const local = Math.min(1, Math.max(0, lum[i] + (lum[i] - broad[i]) * 0.9));
      const gx = fine[i + 1] - fine[i - 1];
      const gy = fine[i + w] - fine[i - w];
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 4);
      let d = Math.pow(local, o.gamma) * 0.92 + edge * o.edges * (0.35 + 0.65 * local);
      // A black point: the shadows clear instead of holding a faint veil.
      d = Math.max(0, (d - 0.06) / 0.94);
      if (matte) {
        const m = matte[i];
        if (rimBand) d += Math.min(1, Math.max(0, m - rimBand[i]) * 2.4) * (o.rim ?? 0);
        d = Math.max(d, (o.floor ?? 0) * m) * smoothstep(0.12, 0.8, m);
      }
      // The frame dissolves: an uneven fade to nothing at every border.
      const wobble = (valueNoise(x * blotch, y * blotch) - 0.5) * feather * 1.1;
      const inset = Math.min(x, w - 1 - x, y, h - 1 - y) + wobble;
      d *= smoothstep(0, feather, inset);
      density[i] = Math.min(o.highlight ?? 0.95, d);
      total += density[i];
    }
  }

  // Dots go on a fine grid of cells (about one dot's worth of area each),
  // chosen by error diffusion with a jittered threshold and then nudged off
  // their cell centres: an even, engraving-like stipple that keeps a face
  // legible, where pure random scatter turns to grain.
  const wanted = total / (scale * scale) / o.areaPerDot;
  const area = o.areaPerDot * Math.max(1, wanted / o.maxDots);
  const cell = Math.sqrt(area / 0.95);
  const cols = Math.max(1, Math.floor(o.width / cell));
  const rows = Math.max(1, Math.floor(o.height / cell));
  const cw = o.width / cols;
  const ch = o.height / rows;
  // If the cap kicks in, the dots grow a little to keep the same light.
  const grow = Math.min(1.4, Math.sqrt(area / o.areaPerDot));
  const rand = mulberry32(o.seed);
  let errNow = new Float32Array(cols + 2);
  let errNext = new Float32Array(cols + 2);
  const cap = Math.min(o.maxDots, Math.ceil(wanted * 1.1) + 16);
  const home = new Float32Array(cap * 2);
  const attrs = new Float32Array(cap * 2);
  let placed = 0;
  for (let r = 0; r < rows && placed < cap; r++) {
    const ltr = (r & 1) === 0;
    for (let k = 0; k < cols; k++) {
      const c = ltr ? k : cols - 1 - k;
      const gx = Math.min(w - 1, ((c + 0.5) * cw * scale) | 0);
      const gy = Math.min(h - 1, ((r + 0.5) * ch * scale) | 0);
      const d = density[gy * w + gx];
      const v = d / 0.95 + errNow[c + 1];
      const on = v > 0.5 + (rand() - 0.5) * 0.36;
      const e = v - (on ? 1 : 0);
      const dir = ltr ? 1 : -1;
      errNow[c + 1 + dir] += e * (7 / 16);
      errNext[c + 1 - dir] += e * (3 / 16);
      errNext[c + 1] += e * (5 / 16);
      errNext[c + 1 + dir] += e * (1 / 16);
      if (!on || placed >= cap) continue;
      home[placed * 2] = (c + 0.5 + (rand() - 0.5) * 0.9) * cw;
      home[placed * 2 + 1] = (r + 0.5 + (rand() - 0.5) * 0.9) * ch;
      attrs[placed * 2] = (0.85 + rand() * 0.5) * o.dotSize * grow * (0.75 + 0.25 * d);
      attrs[placed * 2 + 1] = Math.min(1, (0.7 + rand() * 0.28) * (0.5 + 0.5 * Math.sqrt(d)) * (o.opacity ?? 1));
      placed++;
    }
    [errNow, errNext] = [errNext, errNow];
    errNext.fill(0);
  }
  return { count: placed, home: home.slice(0, placed * 2), attrs: attrs.slice(0, placed * 2) };
}
