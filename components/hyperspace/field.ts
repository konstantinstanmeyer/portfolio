// The hyperspace overlay's picture, after Star Wars' jump: the dots on screen
// stretch into streaks and fly past the viewer while the page goes dark
// behind them; then the streaks shrink back to points and fade as the new
// page comes up. It only draws: when to drop out is the jump's call
// (starfield.ts), sent as messages. It runs in a worker where it can (the
// arriving page's set-up can't stall it there) and on the page otherwise.
//
// Stars live in a simple pinhole camera looking down +z at the viewport's
// centre: z = 1 is the screen itself, so a star launched from a dot is
// back-projected to a random depth and starts exactly where the dot was.
// Each frame they all move toward the viewer by the current speed, and each
// is drawn as the stretch of its path the shutter saw (a motion-blurred
// streak), brighter and wider the nearer it is, added like light.

import { PALETTE } from "@/components/stipple/palette";

export type ToField =
  | {
      type: "begin";
      width: number;
      height: number;
      dpr: number;
      /** Reduced motion: no stars, only the paper fading up and back down. */
      still: boolean;
      /** ms for the paper to come up. */
      cover: number;
      /** ms the drop-out takes. */
      drop: number;
      /** Stars in all. */
      total: number;
      /** The page's dots to launch from: [x, y, diameter, opacity] per dot, viewport CSS px. */
      dots: Float32Array;
      /** Paper already up at the start (1: the page is covered at once). */
      from: number;
    }
  | { type: "resize"; width: number; height: number; dpr: number }
  /** Drop out now. */
  | { type: "drop" }
  /** Stop, and let go of the backing store. */
  | { type: "end" };

export type ToFieldWorker = ToField | { type: "init"; canvas: OffscreenCanvas };
export type FromField = { type: "failed" };

/** Animation frames, from the window or a worker. */
export interface Frames {
  request(callback: (now: number) => void): number;
  cancel(id: number): void;
}

/** How many stars for a viewport: about one per 420 CSS px², within bounds. */
export function starBudget(width: number, height: number): number {
  return Math.round(Math.min(3400, Math.max(900, (width * height) / 420)));
}

// Depth, in screen distances: stars spawn out to FAR and pass the viewer at NEAR.
const FAR = 4;
const NEAR = 0.03;
// Full speed, depth units per second, reached ACCEL ms after the click (ease-in).
const VMAX = 7.5;
const ACCEL = 620;
// Speed's time constant (ms) when dropping out of it.
const DECAY = 80;
// Seconds of travel each streak shows.
const SHUTTER = 0.05;
// Streaks longer than this (CSS px) dim a little, as their light spreads.
const STREAK_REF = 70;
// A streak whose tail leaves the screen by this much (CSS px) is recycled.
const PAD = 24;

// Strokes are batched by width and opacity: one path per bucket.
const ALPHA_LEVELS = 14;
const WIDTH_BASE = 0.5;
const WIDTH_STEP = Math.log(1.38);
const WIDTH_LEVELS = 8;
const BUCKETS = ALPHA_LEVELS * WIDTH_LEVELS;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class StarField {
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: Context2D | null = null;
  private frames: Frames;
  private raf = 0;
  private running = false;
  private still = false;
  private coverMs = 260;
  private dropMs = 640;

  // Timeline (this thread's clock, ms; -1 = not yet).
  private t0 = 0;
  private last = 0;
  private dropAt = -1;
  private bgFrom = 0;
  private bgAtDrop = 1;
  private vAtDrop = 0;
  // As last drawn.
  private bg = 0;
  private speed = 0;

  // Viewport (CSS px) and the camera's scale: a unit offset at z = 1 is S px.
  private width = 0;
  private height = 0;
  private dpr = 1;
  private scale = 1;

  // Stars, structure-of-arrays.
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private z = new Float32Array(0);
  /** Diameter (CSS px) and opacity at depth `ref`. */
  private size = new Float32Array(0);
  private alpha = new Float32Array(0);
  private ref = new Float32Array(0);
  /** 1 for stars launched from the page's own dots, 0 for the field around them. */
  private launched = new Uint8Array(0);
  // Per-frame scratch: segment ends, bucket of each star, bucket order.
  private seg = new Float32Array(0);
  private bucket = new Int16Array(0);
  private order = new Int32Array(0);
  private counts = new Int32Array(BUCKETS + 1);
  private cursor = new Int32Array(BUCKETS);

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, frames: Frames) {
    this.canvas = canvas;
    this.frames = frames;
  }

  /** Handles one message; false if this canvas can't draw at all. */
  handle(msg: ToField): boolean {
    switch (msg.type) {
      case "begin":
        return this.begin(msg);
      case "resize":
        this.resize(msg.width, msg.height, msg.dpr);
        return true;
      case "drop":
        if (this.running && this.dropAt < 0) {
          this.dropAt = performance.now();
          this.bgAtDrop = this.bg;
          this.vAtDrop = this.speed;
        }
        return true;
      case "end":
        this.end();
        return true;
    }
  }

  private begin(msg: Extract<ToField, { type: "begin" }>): boolean {
    const ctx = this.ctx ?? (this.canvas.getContext("2d") as Context2D | null);
    if (!ctx) return false;
    this.ctx = ctx;
    // A jump over one still dropping out picks up the paper where it was.
    const carried = this.running && this.dropAt >= 0 ? this.bg : 0;
    this.frames.cancel(this.raf);
    this.still = msg.still;
    this.coverMs = msg.cover;
    this.dropMs = msg.drop;
    this.bgFrom = Math.max(msg.from, carried);
    this.bg = this.bgFrom;
    this.speed = 0;
    this.dropAt = -1;
    this.running = true;
    this.resize(msg.width, msg.height, msg.dpr);
    this.n = 0;
    if (!this.still) this.load(msg.dots, msg.total);
    this.t0 = this.last = performance.now();
    // Paint the first frame now: a cover from paper is up at once.
    this.frame(this.t0);
    return true;
  }

  private resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.scale = 0.5 * Math.hypot(this.width, this.height);
    if (!this.running) return;
    const bw = Math.round(this.width * dpr);
    const bh = Math.round(this.height * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  /** The page's dots become stars where they are; the rest of the budget is a field around them. */
  private load(dots: Float32Array, total: number): void {
    const { width, height, scale } = this;
    const cx = width / 2;
    const cy = height / 2;
    this.allocate(total);
    let n = 0;
    for (let i = 0; i + 3 < dots.length && n < total; i += 4) {
      // Back-projected from where the dot is, to a random depth.
      const z0 = 1 + Math.random() * 2;
      this.x[n] = ((dots[i] - cx) / scale) * z0;
      this.y[n] = ((dots[i + 1] - cy) / scale) * z0;
      this.z[n] = z0;
      this.ref[n] = z0;
      this.size[n] = Math.min(4, Math.max(0.6, dots[i + 2]));
      this.alpha[n] = Math.min(1, dots[i + 3]);
      this.launched[n] = 1;
      n++;
    }
    for (; n < total; n++) this.spawn(n, 0.4 + Math.random() * (FAR - 0.4));
    this.n = total;
  }

  private allocate(total: number): void {
    if (this.x.length < total) {
      this.x = new Float32Array(total);
      this.y = new Float32Array(total);
      this.z = new Float32Array(total);
      this.size = new Float32Array(total);
      this.alpha = new Float32Array(total);
      this.ref = new Float32Array(total);
      this.launched = new Uint8Array(total);
      this.seg = new Float32Array(total * 4);
      this.bucket = new Int16Array(total);
      this.order = new Int32Array(total);
    }
  }

  /** A field star at depth z, over a random point of the screen. */
  private spawn(i: number, z: number): void {
    const sx = (Math.random() - 0.5) * this.width;
    const sy = (Math.random() - 0.5) * this.height;
    this.x[i] = (sx / this.scale) * z;
    this.y[i] = (sy / this.scale) * z;
    this.z[i] = z;
    this.ref[i] = 1;
    this.size[i] = 0.7 + Math.random() * 0.7;
    this.alpha[i] = 0.3 + Math.random() * 0.5;
    this.launched[i] = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = this.frames.request(this.frame);
    const t = now - this.t0;
    const dt = Math.min(0.04, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    const appear = smooth(t / this.coverMs);
    const speedUp = clamp01(t / ACCEL);
    let speed = VMAX * speedUp * speedUp * (1.6 - 0.6 * speedUp);
    let bg = this.bgFrom + (1 - this.bgFrom) * appear;
    let fade = 1;

    if (this.dropAt >= 0) {
      const since = Math.max(0, now - this.dropAt);
      const d = since / this.dropMs;
      if (d >= 1) {
        // Out: the overlay is clear, whenever the page gets round to hiding it.
        this.end();
        return;
      }
      speed = this.vAtDrop * Math.exp(-since / DECAY);
      if (this.still) {
        bg = this.bgAtDrop * (1 - smooth(d));
      } else {
        // The streaks snap back to points first; then the paper lifts and the points go out.
        bg = this.bgAtDrop * (1 - smooth((d - 0.12) / 0.62));
        fade = 1 - smooth((d - 0.3) / 0.7);
      }
    }
    this.bg = bg;
    this.speed = speed;
    this.draw(bg, appear, fade, speed, dt);
  };

  private draw(bg: number, appear: number, fade: number, speed: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h, scale, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    if (bg > 0.002) {
      ctx.globalAlpha = Math.min(1, bg);
      ctx.fillStyle = PALETTE.paper;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.still || this.n === 0 || fade <= 0) return;

    const cx = w / 2;
    const cy = h / 2;
    const dz = speed * dt;
    const tail = speed * SHUTTER;
    const fieldAppear = appear * appear;
    const { x, y, z, size, alpha, ref, launched, seg, bucket, counts } = this;
    counts.fill(0);

    for (let i = 0; i < this.n; i++) {
      let zi = z[i] - dz;
      if (zi < NEAR) {
        this.spawn(i, FAR * (0.7 + Math.random() * 0.3));
        zi = z[i];
      }
      z[i] = zi;
      const kh = scale / zi;
      const kt = scale / (zi + tail);
      const hx = cx + x[i] * kh;
      const hy = cy + y[i] * kh;
      const tx = cx + x[i] * kt;
      const ty = cy + y[i] * kt;
      if (tx < -PAD || tx > w + PAD || ty < -PAD || ty > h + PAD) {
        // Gone past the viewer: back to the far end, seen next frame.
        this.spawn(i, FAR * (0.7 + Math.random() * 0.3));
        bucket[i] = -1;
        continue;
      }
      const near = ref[i] / zi;
      // Nearer is brighter; a long streak spreads its light a little thinner.
      const length = Math.abs(hx - tx) + Math.abs(hy - ty);
      const spread = length > STREAK_REF ? Math.max(0.45, (STREAK_REF / length) ** 0.35) : 1;
      const a =
        Math.min(1, alpha[i] * Math.min(1.8, near ** 0.75)) * spread * (launched[i] ? appear : fieldAppear) * fade;
      const level = Math.round(a * ALPHA_LEVELS);
      if (level <= 0) {
        bucket[i] = -1;
        continue;
      }
      const width = size[i] * Math.min(2.2, Math.max(0.6, Math.sqrt(near)));
      const wl = Math.min(WIDTH_LEVELS - 1, Math.max(0, Math.round(Math.log(width / WIDTH_BASE) / WIDTH_STEP)));
      const b = wl * ALPHA_LEVELS + (Math.min(ALPHA_LEVELS, level) - 1);
      bucket[i] = b;
      counts[b + 1]++;
      const o = i * 4;
      seg[o] = tx;
      seg[o + 1] = ty;
      // A point still needs a little length for its round caps to draw.
      seg[o + 2] = length < 0.05 ? hx + 0.05 : hx;
      seg[o + 3] = hy;
    }

    // Counting sort by bucket, then one stroke per bucket.
    for (let b = 0; b < BUCKETS; b++) counts[b + 1] += counts[b];
    const { order, cursor } = this;
    cursor.set(counts.subarray(0, BUCKETS));
    for (let i = 0; i < this.n; i++) {
      const b = bucket[i];
      if (b >= 0) order[cursor[b]++] = i;
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineCap = "round";
    for (let b = 0; b < BUCKETS; b++) {
      const from = counts[b];
      const to = counts[b + 1];
      if (from === to) continue;
      ctx.globalAlpha = ((b % ALPHA_LEVELS) + 1) / ALPHA_LEVELS;
      ctx.lineWidth = WIDTH_BASE * Math.exp(Math.floor(b / ALPHA_LEVELS) * WIDTH_STEP);
      ctx.beginPath();
      for (let j = from; j < to; j++) {
        const o = order[j] * 4;
        ctx.moveTo(seg[o], seg[o + 1]);
        ctx.lineTo(seg[o + 2], seg[o + 3]);
      }
      ctx.stroke();
    }
  }

  /** Stops, clear, backing store released until the next jump. */
  private end(): void {
    this.frames.cancel(this.raf);
    this.raf = 0;
    this.running = false;
    this.n = 0;
    this.bg = 0;
    this.dropAt = -1;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
