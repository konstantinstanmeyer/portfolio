// A live stipple canvas in its own box (unlike the name's full-viewport
// one): DPR capped at 2, paused while offscreen or the tab is hidden, and
// torn down on dispose. The dots are the name's: the same renderer and the
// same particle simulation, so they drift on the same air. Big sets simulate
// in a worker; small ones step here.
//
// By default the cursor never stirs the dots (no velocity is fed to the
// simulation): it only parts them, like a lens, and a "brush" closes the
// parting again as soon as the cursor rests. With `stir` the dots also pick
// up its movement, as the home page's name does.

import { createDotRenderer, MAX_TITLES, type DotRenderer } from "./renderer";
import { createSim } from "./sim-client";
import { expandClusters, type Clusters } from "./clusters";
import { registerDotSource } from "./dot-sources";
import { ParticleField, type SimTargets } from "./simulation";

/** Dots to draw: [x, y] homes and [size, opacity] looks. */
export interface Dots {
  count: number;
  home: Float32Array;
  attrs: Float32Array;
}

/** What the simulation needs plus each dot's [size, opacity]. */
export interface StageTargets extends SimTargets {
  attrs: Float32Array;
  /**
   * Draw more dots than are simulated (clusters.ts): the targets are then the
   * carriers, and these are the dots drawn from them. Titles don't apply.
   */
  clusters?: Clusters;
}

/** Where every dot goes, and how it looks, while a title stands in. */
export interface StageTitle {
  home: Float32Array;
  attrs: Float32Array;
}

export interface StageOptions {
  /** Run the simulation on this thread (cheaper than a worker for small sets). */
  inline?: boolean;
  /**
   * How the cursor meets the dots: "lens" parts them while it is over the
   * canvas, "brush" parts them only while it moves.
   */
  pointer?: "none" | "lens" | "brush";
  /** The dots pick up the cursor's movement too, as the name's do. */
  stir?: boolean;
  /** Seconds for a title's look to fade in or out. */
  morphTime?: number;
  /** Where (canvas CSS px) the cursor may part the dots; everywhere when absent. */
  pointerAllowed?: (x: number, y: number) => boolean;
  /** IntersectionObserver margin for counting as on screen. */
  margin?: string;
  /** The canvas has a new size (CSS px): rebuild for it. Called once at start. */
  onSize?: (width: number, height: number) => void;
  /** The first frame with dots has been drawn. */
  onDrawn?: () => void;
  /** Rebuild (onSize) when the screen's pixel ratio changes, as well as on resize. */
  rebuildOnDpr?: boolean;
  /**
   * The simulation can't keep up with a clustered set (clusters.ts): while
   * it first moves, fewer than SLOW_STEPS fresh steps a second arrive. Called
   * at most once per set; never for unclustered sets or under reduced motion.
   */
  onSlowSim?: () => void;
}

/** The parts of the simulation a stage drives (worker or inline). */
interface StageSim {
  readonly peakSpeed: number;
  setTargets(targets: SimTargets, width: number, height: number, spawn: "home"): void;
  setTitle(index: number, home: Float32Array): void;
  hoverIcon(index: number | null): void;
  setReducedMotion(reduced: boolean): void;
  pointerMove(x: number, y: number, dt: number): void;
  pointerLeave(): void;
  request(dt: number, idle: boolean): void;
  take(): { pos: Float32Array; count: number } | null;
  release(frame: { pos: Float32Array; count: number }): void;
  dispose(): void;
}

class InlineSim implements StageSim {
  private field = new ParticleField();
  private fresh = false;
  private frame = { pos: this.field.pos, count: 0 };
  get peakSpeed() {
    return this.field.peakSpeed;
  }
  setTargets(targets: SimTargets, width: number, height: number, spawn: "home") {
    this.field.setTargets(targets, width, height, spawn);
  }
  setTitle(index: number, home: Float32Array) {
    this.field.setTitle(index, home);
  }
  hoverIcon(index: number | null) {
    this.field.hoverIcon(index);
  }
  setReducedMotion(reduced: boolean) {
    this.field.setReducedMotion(reduced);
  }
  pointerMove(x: number, y: number, dt: number) {
    this.field.pointerMove(x, y, dt);
  }
  pointerLeave() {
    this.field.pointerLeave();
  }
  request(dt: number, idle: boolean) {
    this.field.step(dt, idle);
    this.frame.pos = this.field.pos;
    this.frame.count = this.field.count;
    this.fresh = true;
  }
  take() {
    if (!this.fresh) return null;
    this.fresh = false;
    return this.frame;
  }
  release() {}
  dispose() {}
}

const MAX_DPR = 2;
// Watching for a simulation that can't keep up: after new targets have been
// drawn and moving for SLOW_WARM_MS (the worker warming up), count fresh steps
// over the next SLOW_SPAN_MS of motion; fewer than SLOW_STEPS a second is slow.
const SLOW_WARM_MS = 300;
const SLOW_SPAN_MS = 1000;
const SLOW_STEPS = 40;
// A clustered set's focus pull: each drawn dot starts scattered and glides in.
const PULL_HOLD_MS = 160;
const PULL_MS = 900;
// After this long without input, drop to ~30 fps for the ambient drift.
const IDLE_AFTER_MS = 2000;
const IDLE_FRAME_MS = 1000 / 30 - 4;
// Below this peak speed (px/s) the dots count as at rest.
const SETTLED_SPEED = 25;
const REBUILD_DELAY_MS = 140;
// A brush lets go this long after the cursor stops.
const BRUSH_LINGER_MS = 240;
// The cursor wakes the stage only within this distance of the canvas (CSS px).
const POINTER_REACH = 160;

export class DotStage {
  /** Whether the visitor asked for reduced motion (live). */
  reduced: boolean;
  width = 0;
  height = 0;
  private canvas: HTMLCanvasElement;
  private opts: StageOptions;
  private renderer: DotRenderer | null;
  private sim: StageSim;
  private targets: StageTargets | null = null;
  private titleAttrs: (Float32Array | null)[] = [];
  private morph = new Float32Array(MAX_TITLES);
  private morphTo = -1;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private lastInput = 0;
  private dirty = false;
  private drawnCount = 0;
  private drawn = false;
  private visible = false;
  private paused = false;
  private contextLost = false;
  private disposed = false;
  private sized = false;
  private rebuildTimer = 0;
  private brushTimer = 0;
  private pointerX = 0;
  private pointerY = 0;
  private hasPointer = false;
  private pointerOn = false;
  private lastPointerTime = 0;
  // Clustered targets: their drawn dots' positions, rebuilt each fresh frame,
  // from the newest carrier positions.
  private expanded = new Float32Array(0);
  private carriers = new Float32Array(0);
  private hasCarriers = false;
  private slow = { active: 0, steps: 0, done: true };
  // A clustered set's focus pull: each drawn dot's scatter, and when it began.
  private scatter: Float32Array | null = null;
  private pullStart = 0;
  private maxDpr: number;
  // Scales drawn dot sizes reported to page transitions (finer dots read as the usual ones).
  private launchScale = 1;
  private motionQuery: MediaQueryList;
  private resizeObserver: ResizeObserver;
  private intersection: IntersectionObserver;
  private cleanups: (() => void)[] = [];

  /** Which renderer draws the dots ("2d" is the slow fallback: keep its sets small). */
  get kind(): "webgl" | "2d" | null {
    return this.renderer?.kind ?? null;
  }

  /** Device pixels per CSS pixel the canvas is drawn at. */
  get pixelRatio(): number {
    return this.dpr;
  }

  constructor(canvas: HTMLCanvasElement, opts: StageOptions = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.maxDpr = MAX_DPR;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.motionQuery.matches;
    this.sim = opts.inline ? new InlineSim() : createSim();
    this.sim.setReducedMotion(this.reduced);
    this.renderer = createDotRenderer(canvas);

    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(canvas);
    this.intersection = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting;
        if (this.visible) this.wake();
        else this.stop();
      },
      { rootMargin: opts.margin ?? "80px 0px" },
    );
    this.intersection.observe(canvas);
    this.measure();
    // The dots at home, in viewport coordinates, for a page transition to launch from.
    this.cleanups.push(
      registerDotSource(() => {
        const t = this.targets;
        if (!t || !this.drawn) return null;
        const rect = this.canvas.getBoundingClientRect();
        // Clustered: the drawn dots at home (their carriers' homes plus offsets).
        const c = t.clusters;
        const count = c ? c.count : t.count;
        const pos = c ? expandClusters(c, t.home, new Float32Array(count * 2)) : Float32Array.from(t.home);
        for (let i = 0; i < count; i++) {
          pos[i * 2] += rect.left;
          pos[i * 2 + 1] += rect.top;
        }
        let attrs = c ? c.attrs : t.attrs;
        if (this.launchScale !== 1) {
          attrs = Float32Array.from(attrs);
          for (let i = 0; i < count; i++) attrs[i * 2] *= this.launchScale;
        }
        return { pos, attrs, count };
      }),
    );

    this.listen(document, "visibilitychange", () => (document.hidden ? this.stop() : this.wake()));
    this.listen(this.motionQuery, "change", () => {
      this.reduced = this.motionQuery.matches;
      this.sim.setReducedMotion(this.reduced);
      if (this.reduced) this.releasePointer();
      this.wake();
    });
    this.listen(canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stop();
    });
    this.listen(canvas, "webglcontextrestored", () => {
      this.contextLost = false;
      this.renderer = createDotRenderer(canvas);
      this.resizeBuffer();
      const t = this.targets;
      if (t) this.renderer?.setAttributes(t.clusters?.attrs ?? t.attrs, t.clusters?.count ?? t.count);
      this.titleAttrs.forEach((attrs, k) => attrs && this.targets && this.renderer?.setTitle(k, attrs, this.targets.count));
      this.wake();
    });
    // Moving between displays changes the pixel ratio without a resize.
    let dprQuery: MediaQueryList | null = null;
    const onDpr = () => {
      this.resizeBuffer();
      this.wake();
      watchDpr();
      if (this.opts.rebuildOnDpr && this.sized) {
        window.clearTimeout(this.rebuildTimer);
        this.rebuildTimer = window.setTimeout(() => this.opts.onSize?.(this.width, this.height), REBUILD_DELAY_MS);
      }
    };
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener("change", onDpr);
    };
    watchDpr();
    this.cleanups.push(() => dprQuery?.removeEventListener("change", onDpr));

    if (opts.pointer && opts.pointer !== "none") {
      this.listen(window, "pointermove", (e) => this.onPointerMove(e as PointerEvent), { passive: true });
      this.listen(window, "scroll", () => this.hasPointer && this.feedPointer(), { passive: true });
      this.listen(document.documentElement, "pointerleave", () => {
        this.hasPointer = false;
        this.lastPointerTime = 0;
        this.releasePointer();
      });
    }
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /** Reads the canvas's CSS size; rebuilds (debounced) when it changes. */
  private measure(): void {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.resizeBuffer();
    // Resizing clears the canvas; redraw the last positions even if the loop had stopped.
    this.wake();
    if (w === 0 || h === 0) return;
    window.clearTimeout(this.rebuildTimer);
    if (!this.sized) {
      this.sized = true;
      this.opts.onSize?.(w, h);
    } else {
      this.rebuildTimer = window.setTimeout(() => this.opts.onSize?.(this.width, this.height), REBUILD_DELAY_MS);
    }
  }

  private resizeBuffer(): void {
    // Only WebGL gets a finer backing; the 2D fallback draws every dot itself.
    const most = this.renderer?.kind === "webgl" ? this.maxDpr : MAX_DPR;
    this.dpr = Math.min(most, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.renderer?.resize(this.width, this.height, this.dpr);
    this.dirty = true;
  }

  /**
   * The highest pixel ratio the canvas is backed at (default 2; WebGL only).
   * Takes effect at once: call before building dots that depend on pixelRatio.
   */
  setMaxDpr(maxDpr: number): void {
    if (maxDpr === this.maxDpr) return;
    this.maxDpr = maxDpr;
    this.resizeBuffer();
    this.wake();
  }

  /** Scales the dot sizes page transitions launch from (1: as drawn). */
  setLaunchScale(scale: number): void {
    this.launchScale = scale;
  }

  /**
   * A clustered set's focus pull: every drawn dot starts scattered across a
   * disc of `radius` (CSS px) and glides into place, as defocus() and moveTo()
   * do for unclustered dots (which would scatter whole clusters here).
   */
  focusPull(radius: number, seed: number): void {
    const c = this.targets?.clusters;
    if (!c || this.reduced) return;
    this.scatter = defocus(new Float32Array(c.count * 2), c.count, radius, seed);
    this.pullStart = performance.now();
    this.wake();
  }

  /** Point the dots at new homes. The first set appears at home; later ones glide there. */
  setTargets(targets: StageTargets): void {
    if (this.disposed) return;
    this.targets = targets;
    this.sim.setTargets(targets, this.width, this.height, "home");
    // setTargets clears the simulation's titles; they get rebuilt.
    this.titleAttrs = [];
    this.morph.fill(0);
    if (this.morphTo >= 0) this.sim.hoverIcon(this.morphTo);
    const c = targets.clusters;
    const drawCount = c ? c.count : targets.count;
    if (c && this.expanded.length < drawCount * 2) this.expanded = new Float32Array(drawCount * 2);
    if (c && this.carriers.length < targets.count * 2) this.carriers = new Float32Array(targets.count * 2);
    this.hasCarriers = false;
    this.scatter = null;
    this.renderer?.setAttributes(c ? c.attrs : targets.attrs, drawCount);
    this.renderer?.setMorph(this.morph);
    // No positions for these dots yet; keep the last frame up until they arrive.
    if (drawCount !== this.drawnCount) this.drawnCount = 0;
    this.slow = { active: 0, steps: 0, done: !this.opts.onSlowSim || !c || this.reduced };
    this.wake();
  }

  /** Same dots and looks, new homes: they glide there (a focus pull, a relayout). */
  moveTo(home: Float32Array): void {
    if (!this.targets || home.length !== this.targets.count * 2) return;
    this.targets = { ...this.targets, home };
    this.sim.setTargets(this.targets, this.width, this.height, "home");
    this.titleAttrs = [];
    this.morph.fill(0);
    this.renderer?.setMorph(this.morph);
    this.wake();
  }

  /** Forgets every dot, so the next setTargets places them afresh. */
  clear(): void {
    this.sim.setTargets(
      { count: 0, home: new Float32Array(0), group: new Uint8Array(0), icons: [], iconField: null, blockHeight: 0 },
      this.width,
      this.height,
      "home",
    );
    this.drawnCount = 0;
    this.hasCarriers = false;
    this.scatter = null;
  }

  setTitle(index: number, title: StageTitle): void {
    if (this.disposed || !this.targets || this.targets.clusters || index >= MAX_TITLES) return;
    if (title.home.length !== this.targets.count * 2) return;
    this.sim.setTitle(index, title.home);
    this.renderer?.setTitle(index, title.attrs, this.targets.count);
    this.titleAttrs[index] = title.attrs;
    this.wake();
  }

  /** Let title `index` stand in for the dots' own shape (-1 for none). */
  showTitle(index: number): void {
    this.morphTo = index;
    this.sim.hoverIcon(index < 0 ? null : index);
    this.wake();
  }

  /** Stops drawing (e.g. while the canvas is faded out) until resumed. */
  pause(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stop();
    else this.wake();
  }

  private onPointerMove(e: PointerEvent): void {
    // Touch drags are scrolls; only a hovering pointer parts the dots.
    if (e.pointerType === "touch") return;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.hasPointer = true;
    const dt = this.lastPointerTime ? (e.timeStamp - this.lastPointerTime) / 1000 : 0;
    this.lastPointerTime = e.timeStamp;
    this.feedPointer(dt);
    if (this.opts.pointer === "brush" && this.pointerOn) {
      window.clearTimeout(this.brushTimer);
      this.brushTimer = window.setTimeout(() => this.releasePointer(), BRUSH_LINGER_MS);
    }
  }

  private feedPointer(dt = 0): void {
    if (!this.visible || this.reduced || !this.targets) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = this.pointerX - rect.left;
    const y = this.pointerY - rect.top;
    const reach = this.opts.pointer === "lens" ? 0 : POINTER_REACH;
    const inside = x > -reach && y > -reach && x < rect.width + reach && y < rect.height + reach;
    if (inside && (this.opts.pointerAllowed?.(x, y) ?? true)) {
      // Without stir, no elapsed time: the dots part around the cursor but never pick up its velocity.
      this.sim.pointerMove(x, y, this.opts.stir ? dt : 0);
      this.pointerOn = true;
      this.wake();
    } else {
      this.releasePointer();
    }
  }

  private releasePointer(): void {
    window.clearTimeout(this.brushTimer);
    if (!this.pointerOn) return;
    this.pointerOn = false;
    this.sim.pointerLeave();
    this.wake();
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const renderer = this.renderer;
    const sim = this.sim;
    // Nothing to draw yet: setTargets (or a restored context) wakes the loop again.
    if (!renderer || !this.targets) {
      this.stop();
      return;
    }
    const quiet = now - this.lastInput > IDLE_AFTER_MS && sim.peakSpeed < SETTLED_SPEED;
    let morphing = false;
    for (let k = 0; k < MAX_TITLES; k++) {
      if (this.morph[k] !== (k === this.morphTo && this.titleAttrs[k] ? 1 : 0)) morphing = true;
    }
    const pulling = this.scatter !== null;
    if (quiet && this.reduced && !this.dirty && !morphing && this.drawnCount > 0) {
      // Reduced motion: nothing drifts, so once settled there is nothing to draw.
      this.stop();
      return;
    }
    if (quiet && !this.dirty && !morphing && !pulling && this.last && now - this.last < IDLE_FRAME_MS) return;

    const dt = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    const blend = 1 - Math.exp(-dt / (this.opts.morphTime ?? 0.22));
    for (let k = 0; k < MAX_TITLES; k++) {
      const target = k === this.morphTo && this.titleAttrs[k] ? 1 : 0;
      const gap = target - this.morph[k];
      if (gap === 0) continue;
      this.dirty = true;
      this.morph[k] = Math.abs(gap) < 0.002 ? target : this.morph[k] + gap * blend;
    }
    // Draw the newest finished positions, then ask for the next step; with the
    // simulation in a worker, it computes while this frame displays.
    const done = sim.take();
    const c = this.targets.clusters;
    let drew = false;
    if (c) {
      // Clustered: a fresh step moves the carriers; every dot is drawn from its own.
      const fresh = !!done && done.count === this.targets.count;
      if (fresh) {
        this.carriers.set(done.pos.subarray(0, this.targets.count * 2));
        this.hasCarriers = true;
        this.drawnCount = c.count;
      }
      if ((fresh || this.dirty || pulling) && this.drawnCount > 0 && this.hasCarriers) {
        const pos = expandClusters(c, this.carriers, this.expanded);
        if (this.scatter) this.applyPull(pos, now);
        renderer.setMorph(this.morph);
        renderer.draw(pos, this.drawnCount);
        drew = true;
      }
    } else {
      if (done && done.count === this.targets.count) this.drawnCount = done.count;
      if ((done || this.dirty) && this.drawnCount > 0) {
        renderer.setMorph(this.morph);
        renderer.draw(done && done.count === this.drawnCount ? done.pos : null, this.drawnCount);
        drew = true;
      }
    }
    if (drew) {
      this.dirty = false;
      if (!this.drawn) {
        this.drawn = true;
        this.opts.onDrawn?.();
      }
    }
    this.watchSpeed(!!done && done.count === this.targets.count, quiet, dt);
    if (done) sim.release(done);
    sim.request(dt, quiet);
  };

  /** Each drawn dot's share of its focus-pull scatter, easing to nothing. */
  private applyPull(pos: Float32Array, now: number): void {
    const scatter = this.scatter;
    if (!scatter) return;
    const t = Math.max(0, now - this.pullStart - PULL_HOLD_MS) / PULL_MS;
    if (t >= 1) {
      this.scatter = null;
      return;
    }
    // Ease out, like a spring settling.
    const left = Math.pow(1 - t, 3);
    for (let i = 0; i < this.drawnCount * 2; i++) pos[i] += scatter[i] * left;
  }

  /**
   * Counts fresh steps over the first stretch of motion after new targets:
   * too few a second (whatever the display's refresh rate) and the
   * simulation can't keep up. Settling first ends the watch without a verdict.
   */
  private watchSpeed(fresh: boolean, quiet: boolean, dt: number): void {
    const slow = this.slow;
    if (slow.done || this.drawnCount === 0) return;
    if (quiet || this.reduced) {
      slow.done = true;
      return;
    }
    slow.active += dt * 1000;
    if (slow.active <= SLOW_WARM_MS) return;
    if (fresh) slow.steps++;
    const span = slow.active - SLOW_WARM_MS;
    if (span < SLOW_SPAN_MS) return;
    slow.done = true;
    if ((slow.steps * 1000) / span < SLOW_STEPS) this.opts.onSlowSim?.();
  }

  private start(): void {
    if (this.raf || !this.visible || this.paused || document.hidden || this.disposed || this.contextLost) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  wake(): void {
    this.lastInput = performance.now();
    this.start();
  }

  /** Stops and frees everything; with `release`, the canvas's WebGL context too (it won't be drawn on again). */
  dispose(release = false): void {
    this.disposed = true;
    this.stop();
    window.clearTimeout(this.rebuildTimer);
    window.clearTimeout(this.brushTimer);
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.renderer?.dispose(release);
    this.sim.dispose();
  }
}

/**
 * The same homes thrown out of focus: each dot scattered across a disc
 * around its spot, the way a defocused point spreads into a circle of
 * confusion. Focusing is then just letting the dots glide home.
 */
export function defocus(home: Float32Array, count: number, radius: number, seed: number): Float32Array {
  const out = Float32Array.from(home.subarray(0, count * 2));
  let s = seed >>> 0 || 1;
  for (let i = 0; i < count; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const r = radius * Math.sqrt((s >>> 0) / 4294967296);
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const a = ((s >>> 0) / 4294967296) * Math.PI * 2;
    out[i * 2] += Math.cos(a) * r;
    out[i * 2 + 1] += Math.sin(a) * r;
  }
  return out;
}
