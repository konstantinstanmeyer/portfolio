// The jump between pages: the old page's dots launch as stars and the page
// goes dark behind them (field.ts draws it); the route changes under that
// cover; and once the new page is in and has drawn, the stars drop out over
// it. This side keeps the timeline: when to change the route, when the new
// page is ready, when to drop out, and the overlay element itself.

import { snapshotDots } from "@/components/stipple/dot-sources";
import { PALETTE } from "@/components/stipple/palette";
import { StarField, starBudget, type FromField, type ToField } from "./field";
import { setLanding } from "./landing";

/** What a jump asks of the page around it. */
export interface JumpHooks {
  /** The old page is hidden: change the route now. Not called if the jump is cut short first. */
  navigate(): void;
  /**
   * The committed route's path (polled every frame). The jump has landed once
   * it changes, and lands afresh if it changes again (a back/forward).
   */
  path(): string;
  /** The jump gave up on a route change that is still loading; it may yet land, uncovered. */
  abandoned?(): void;
}

interface Timing {
  /** ms for the old page to go dark. */
  cover: number;
  /** Earliest drop-out, ms from the click. */
  min: number;
  /** ms from the new page's first drawn dots to the drop-out (a frame or two to settle). */
  beat: number;
  /** ms after the new route commits to stop waiting for dots (a page without any). */
  settle: number;
  /** ms to drop out and reveal the new page. */
  drop: number;
  /** Reveal anyway after this long (ms from the click) if no route has come in and none is loading. */
  cap: number;
}

const MOTION: Timing = { cover: 260, min: 860, beat: 170, settle: 700, drop: 640, cap: 4000 };
// Reduced motion: no streaks, just a quick fade through the paper.
const STILL: Timing = { cover: 170, min: 300, beat: 90, settle: 600, drop: 280, cap: 4000 };
// While the new route is still loading, keep cruising this long (ms from the click):
// a slow load is what the cover is for.
const PENDING_CAP = 12_000;
// A back/forward mid-jump: give the browser's navigation this long to land.
const INTERRUPT_GRACE = 700;
// Animation frames stop in a hidden tab; a timer keeps the timeline going (ms).
const WATCHDOG = 250;

const OVERLAY_STYLE =
  "position:fixed;inset:0;width:100%;height:100%;display:none;z-index:2147483000;" +
  "pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none";

/** Where the overlay is drawn: a worker, or this thread. */
interface FieldPort {
  post(message: ToField, transfer?: Transferable[]): void;
  destroy(): void;
}

function localPort(canvas: HTMLCanvasElement): FieldPort {
  const field = new StarField(canvas, {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  });
  return {
    post: (message) => void field.handle(message),
    destroy: () => void field.handle({ type: "end" }),
  };
}

/** Hands the canvas to a worker; null if this browser can't (the canvas is then untouched). */
function workerPort(canvas: HTMLCanvasElement, onFail: () => void): FieldPort | null {
  if (typeof Worker === "undefined" || typeof canvas.transferControlToOffscreen !== "function") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./field.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  try {
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);
  } catch {
    worker.terminate();
    onFail();
    return null;
  }
  worker.onerror = (event) => {
    event.preventDefault();
    onFail();
  };
  worker.onmessage = ({ data }: MessageEvent<FromField>) => {
    if (data.type === "failed") onFail();
  };
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    destroy: () => worker.terminate(),
  };
}

export class Hyperspace {
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private port: FieldPort | null = null;
  private cancelWarm: () => void;
  private hooks: JumpHooks | null = null;
  private timing: Timing = MOTION;
  private still = false;

  private raf = 0;
  private watchdog = 0;
  private cleanups: (() => void)[] = [];
  private running = false;
  private disposed = false;

  // Timeline (performance.now() ms; -1 = not yet).
  private t0 = 0;
  private lastFrame = 0;
  private navigated = false;
  private interrupted = false;
  /** A cover over a route that committed without one (nothing to navigate, nothing pending). */
  private landed = false;
  /** The committed path, as last seen. */
  private at = "";
  private arrivedAt = -1;
  private readyAt = -1;
  private dropAt = -1;
  private capAt = 0;

  // Viewport, CSS px.
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = this.makeCanvas();
    // Get the worker going while nothing else is, so the first jump has it warm.
    const warm = () => void this.ensurePort();
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(warm, { timeout: 3000 });
      this.cancelWarm = () => cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(warm, 1500);
      this.cancelWarm = () => window.clearTimeout(id);
    }
  }

  /** Whether a jump is under way and still covering (a drop-out can be cut by the next jump). */
  get busy(): boolean {
    return this.running && this.dropAt < 0;
  }

  /**
   * Starts a jump; returns false (and does nothing) if one is already
   * covering. One that is dropping out gives way to it.
   */
  start(hooks: JumpHooks, reducedMotion: boolean): boolean {
    return this.begin(hooks, reducedMotion, false);
  }

  /**
   * Covers a route that is committing right now without a jump (one that
   * loaded after its jump gave up on it): the paper is up at once, and lifts
   * once the page has drawn. Call it before paint (a layout effect).
   */
  land(hooks: JumpHooks): void {
    this.begin(hooks, true, true);
  }

  /** Stops at once, overlay removed (unmount). */
  dispose(): void {
    this.disposed = true;
    this.cancelWarm();
    this.finish("dispose");
    this.port?.destroy();
    this.port = null;
    this.canvas.remove();
  }

  private begin(hooks: JumpHooks, reducedMotion: boolean, landed: boolean): boolean {
    if (this.running) {
      if (this.dropAt < 0) return false;
      this.finish("cut");
    }
    const port = this.ensurePort();
    const now = performance.now();
    this.hooks = hooks;
    this.still = reducedMotion;
    this.timing = reducedMotion ? STILL : MOTION;
    this.running = true;
    this.landed = landed;
    this.navigated = landed;
    this.interrupted = false;
    this.at = hooks.path();
    this.arrivedAt = -1;
    this.readyAt = -1;
    this.dropAt = -1;
    this.t0 = this.lastFrame = now;
    this.capAt = now + this.timing.cap;
    if (landed) setLanding(true);

    // Show the overlay; it swallows stray clicks until the drop-out starts.
    const style = this.canvas.style;
    style.display = "block";
    style.pointerEvents = "auto";
    // A cover over a page already committing has to be up this frame, before
    // the drawing (maybe in a worker) gets there.
    style.backgroundColor = landed ? PALETTE.paper : "";
    this.measure();
    const dots = this.still ? new Float32Array(0) : this.sample();
    port.post(
      {
        type: "begin",
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        still: this.still,
        cover: this.timing.cover,
        drop: this.timing.drop,
        total: starBudget(this.width, this.height),
        dots,
        from: landed ? 1 : 0,
      },
      [dots.buffer],
    );

    this.listen(window, "resize", () => {
      this.measure();
      this.port?.post({ type: "resize", width: this.width, height: this.height, dpr: this.dpr });
    });
    // Back/forward mid-jump: don't push on top of it; land wherever it goes.
    this.listen(window, "popstate", () => {
      this.interrupted = true;
      setLanding(true);
      this.capAt = Math.min(this.capAt, performance.now() + INTERRUPT_GRACE);
    });
    this.watchdog = window.setInterval(() => {
      const t = performance.now();
      if (t - this.lastFrame > WATCHDOG - 50) this.tick(t);
    }, WATCHDOG);
    this.raf = requestAnimationFrame(this.frame);
    return true;
  }

  private makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.hyperspace = "";
    canvas.style.cssText = OVERLAY_STYLE;
    this.host.appendChild(canvas);
    return canvas;
  }

  private ensurePort(): FieldPort {
    if (this.port) return this.port;
    const worker = workerPort(this.canvas, this.workerFailed);
    if (worker) this.port = worker;
    // (A failed hand-over has already swapped in a fresh canvas and its port.)
    this.port ??= localPort(this.canvas);
    return this.port;
  }

  /** The worker couldn't draw: carry on with a fresh canvas on this thread. */
  private workerFailed = (): void => {
    if (this.disposed) return;
    this.port?.destroy();
    const old = this.canvas;
    this.canvas = this.makeCanvas();
    this.canvas.style.cssText = old.style.cssText;
    old.remove();
    this.port = localPort(this.canvas);
    // Any jump under way goes on as a plain fade.
    if (this.running) {
      this.measure();
      this.port.post({
        type: "begin",
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        still: true,
        cover: this.timing.cover,
        drop: this.timing.drop,
        total: 0,
        dots: new Float32Array(0),
        from: 1,
      });
      if (this.dropAt >= 0) this.port.post({ type: "drop" });
    }
  };

  private listen(target: EventTarget, type: string, handler: () => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private measure(): void {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
  }

  /** A sample of the page's visible dots to launch from: [x, y, diameter, opacity] each. */
  private sample(): Float32Array {
    const { width, height } = this;
    const maxDots = Math.round(starBudget(width, height) * 0.72);
    let snaps: ReturnType<typeof snapshotDots> = [];
    try {
      snaps = snapshotDots();
    } catch {
      snaps = [];
    }
    let visible = 0;
    for (const s of snaps) {
      for (let i = 0; i < s.count; i++) {
        if (s.attrs[i * 2 + 1] > 0.01 && onScreen(s.pos[i * 2], s.pos[i * 2 + 1], width, height)) visible++;
      }
    }
    const keep = visible > 0 ? Math.min(1, maxDots / visible) : 0;
    const out = new Float32Array(Math.min(visible, maxDots) * 4);
    let n = 0;
    for (const s of snaps) {
      for (let i = 0; i < s.count && n * 4 < out.length; i++) {
        const o = s.attrs[i * 2 + 1];
        const px = s.pos[i * 2];
        const py = s.pos[i * 2 + 1];
        if (!(o > 0.01) || !onScreen(px, py, width, height) || Math.random() >= keep) continue;
        out[n * 4] = px;
        out[n * 4 + 1] = py;
        out[n * 4 + 2] = s.attrs[i * 2];
        out[n * 4 + 3] = o;
        n++;
      }
    }
    return n * 4 === out.length ? out : out.slice(0, n * 4);
  }

  /** Changes the route, once. */
  private go(): void {
    // (Not if the route has already moved under the jump.)
    if (!this.running || this.navigated || this.interrupted || this.arrivedAt >= 0) return;
    this.navigated = true;
    // The page that mounts now arrives under the cover.
    setLanding(true);
    try {
      this.hooks?.navigate();
    } catch {
      this.interrupted = true;
      this.capAt = Math.min(this.capAt, performance.now() + INTERRUPT_GRACE);
    }
  }

  /** Whether the route change is out and hasn't landed. */
  private get pending(): boolean {
    return this.navigated && !this.interrupted && !this.landed && this.arrivedAt < 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    this.lastFrame = now;
    this.tick(now);
  };

  private tick(now: number): void {
    if (!this.running) return;
    const { timing } = this;
    const t = now - this.t0;

    const path = this.hooks?.path();
    if (path !== undefined && path !== this.at) {
      // A new page is in (or another one, after a back/forward): wait for it.
      this.at = path;
      this.arrivedAt = now;
      this.readyAt = -1;
    }
    if (t >= timing.cover) this.go();
    // Ready once the new page has drawn its dots (they start a frame or two
    // after it mounts); a page without any, a little after it's in.
    if (this.arrivedAt >= 0 && this.readyAt < 0) {
      if (dotsDrawn()) this.readyAt = now + timing.beat;
      else if (now - this.arrivedAt >= timing.settle) this.readyAt = now;
    }

    if (this.dropAt < 0) {
      const ready = this.readyAt >= 0 && now >= this.readyAt && t >= timing.min;
      // Once the route is in, readiness itself is bounded (by `settle`); before
      // that, a route still loading gets longer than one that went astray.
      const capAt = this.arrivedAt >= 0 ? Infinity : this.pending ? this.t0 + PENDING_CAP : this.capAt;
      if (ready || now >= capAt) {
        this.dropAt = now;
        // The new page is up from here on: it takes the pointer.
        this.canvas.style.pointerEvents = "none";
        this.canvas.style.backgroundColor = "";
        this.port?.post({ type: "drop" });
      }
    } else if (now - this.dropAt >= timing.drop) {
      this.finish("done");
    }
  }

  /** Ends the jump: overlay hidden, everything cancelled. */
  private finish(why: "done" | "cut" | "dispose"): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearInterval(this.watchdog);
    this.watchdog = 0;
    for (const off of this.cleanups) off();
    this.cleanups = [];
    if (!this.running) return;
    const hooks = this.hooks;
    const gaveUp = why === "done" && this.pending;
    this.running = false;
    this.hooks = null;
    setLanding(false);
    if (why !== "cut") {
      const style = this.canvas.style;
      style.display = "none";
      style.pointerEvents = "none";
      style.backgroundColor = "";
      // A cut leaves the drawing to the next jump, which picks up from it.
      this.port?.post({ type: "end" });
    }
    if (gaveUp) hooks?.abandoned?.();
  }
}

function dotsDrawn(): boolean {
  try {
    return snapshotDots().length > 0;
  } catch {
    return false;
  }
}

function onScreen(x: number, y: number, w: number, h: number): boolean {
  return x >= -8 && x <= w + 8 && y >= -8 && y <= h + 8;
}
