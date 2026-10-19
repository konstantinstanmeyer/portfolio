"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { stippleFont } from "./font";
import { createBuilder } from "./build-client";
import { isLanding } from "@/components/hyperspace/landing";
import { registerDotSource } from "./dot-sources";
import type { GlyphId } from "./glyphs";
import { homeLayout, prepareName, prepareTitle, type HomeLayout } from "./raster";
import { createDotRenderer, MAX_TITLES, type DotRenderer } from "./renderer";
import { createSim } from "./sim-client";
import type { Dots } from "./stage";
import type { Rect, StippleTargets, TitleTargets } from "./stipple";

/**
 * What the name turns into while an icon is hovered: other words in its place
 * (`lines`), or words added around it (`before` and `after`) while it stays put.
 */
export type TitleSpec = { lines: string[] } | { before?: string; after: string };

export interface StippleHandle {
  pulse(x: number, y: number): void;
  /** Swell icon `index` (0-based) as a hover state, or none with null. */
  hoverIcon(index: number | null): void;
}

const LINES = ["Konstantin", "Stanmeyer"];
const IDLE_HANDLE: StippleHandle = { pulse: () => {}, hoverIcon: () => {} };
// Titles are painted (cheap) one per moment and shaded in the background.
// Without a worker the shading runs here, so it waits until the intro is over.
const TITLE_GAP_MS = 60;
// Seconds for a title's look to fade in or out as it takes over the name.
const MORPH_TIME = 0.22;
// After this long without input, drop to a cheaper idle cadence: about 30 fps
// at any refresh rate (a little under 1/30 s, so vsync jitter doesn't skip one).
const IDLE_AFTER_MS = 2000;
const IDLE_FRAME_MS = 1000 / 30 - 4;
// Below this peak speed (px/s) the dots count as at rest.
const SETTLED_SPEED = 25;

/** `extra` followed by `rest`. */
function cat(extra: Float32Array, rest: Float32Array): Float32Array {
  const out = new Float32Array(extra.length + rest.length);
  out.set(extra);
  out.set(rest, extra.length);
  return out;
}

/**
 * The name's targets with `extra` dots ahead of its own (first, so their
 * indices hold when the name is rebuilt with a different count). They belong
 * to the name's group, so they move as its dots do, but keep their place and
 * look while a title shows.
 */
function withExtra(t: StippleTargets, extra: Dots): StippleTargets {
  const group = new Uint8Array(extra.count + t.count);
  group.set(t.group, extra.count);
  return {
    ...t,
    count: extra.count + t.count,
    home: cat(extra.home, t.home),
    attrs: cat(extra.attrs, t.attrs),
    group,
    decor: t.decor && { home: cat(extra.home, t.decor.home), attrs: cat(extra.attrs, t.decor.attrs) },
  };
}

interface StippleNameProps {
  ref?: Ref<StippleHandle>;
  /** Icons stippled in a row under the name. */
  icons?: GlyphId[];
  /** For each icon, what the name turns into while it's hovered. */
  titles?: TitleSpec[];
  /** Called with each icon's position whenever the layout is rebuilt. */
  onIconLayout?: (rects: Rect[]) => void;
  /**
   * The home page's layout (raster.ts homeLayout): the name and icons on the
   * left with the portrait on the right, or below the portrait on narrow screens.
   */
  split?: boolean;
  /** With `split`: called with the layout whenever the name is laid out again. */
  onLayout?: (layout: HomeLayout) => void;
  /** With `split`: more dots (page coordinates) to move with the name's, e.g. the portrait. */
  extraDots?: (layout: HomeLayout, kind: "webgl" | "2d") => Promise<Dots | null>;
}

export default function StippleName({
  ref,
  icons = [],
  titles = [],
  onIconLayout,
  split = false,
  onLayout,
  extraDots,
}: StippleNameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<StippleHandle>(IDLE_HANDLE);
  const iconsRef = useRef(icons);
  const titlesRef = useRef(titles);
  const onIconLayoutRef = useRef(onIconLayout);
  const onLayoutRef = useRef(onLayout);
  const extraDotsRef = useRef(extraDots);
  const splitRef = useRef(split);

  useEffect(() => {
    splitRef.current = split;
    iconsRef.current = icons;
    titlesRef.current = titles;
    onIconLayoutRef.current = onIconLayout;
    onLayoutRef.current = onLayout;
    extraDotsRef.current = extraDots;
  });

  useImperativeHandle(ref, () => ({
    pulse: (x, y) => handleRef.current.pulse(x, y),
    hoverIcon: (index) => handleRef.current.hoverIcon(index),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sim = createSim();
    const builder = createBuilder();
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    sim.setReducedMotion(motionQuery.matches);

    const { fontFamily, fontWeight } = stippleFont.style;
    let renderer: DotRenderer | null = null;
    let targets: StippleTargets | null = null;
    // Dots that move with the name's (ahead of them in `targets`).
    let extra: Dots | null = null;
    let width = 0;
    let height = 0;
    let builtFor = "";
    // Bumped per build, so results for an older layout are dropped.
    let version = 0;
    // Dots in the newest drawn frame (0 until positions for the current build arrive).
    let drawnCount = 0;
    // Without a build worker: the build whose titles wait for the intro to end.
    let titlesPending = 0;
    let contextLost = false;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let lastInput = 0;
    let dirty = false;
    let fontReady = false;
    let disposed = false;
    let rebuildTimer = 0;
    let activePointer: number | null = null;
    // Title crossfade: each title's weight, and which one is wanted (-1 = name).
    const morph = new Float32Array(MAX_TITLES);
    let morphTo = -1;
    let titleTimer = 0;
    const titleAttrs: (Float32Array | null)[] = [];
    const titleHomes: (Float32Array | null)[] = [];
    let lastPointerTime = 0;

    const sizeCanvas = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer?.resize(width, height, dpr);
      dirty = true;
    };

    const uploadTargets = () => {
      if (!renderer || !targets) return;
      renderer.setAttributes(targets.attrs, targets.count);
      // The renderer's position buffer was just reset; wait for real positions.
      drawnCount = 0;
      dirty = true;
    };

    const build = (spawn: "enter" | "home") => {
      if (disposed || !renderer || !fontReady) return;
      const key = `${width}x${height}`;
      if (key === builtFor) return;
      builtFor = key;
      const mine = ++version;
      const layout = splitRef.current ? homeLayout(width, height) : null;
      if (layout) onLayoutRef.current?.(layout);
      let job;
      try {
        job = prepareName({
          area: layout?.name,
          align: layout?.split ? "left" : "center",
          lines: LINES,
          icons: iconsRef.current,
          // Only one set of words-around-the-name is supported; the first wins.
          decor: titlesRef.current.find((spec) => "after" in spec),
          fontFamily,
          fontWeight,
          width,
          height,
          maxParticles: renderer.kind === "2d" ? 12000 : width < 700 ? 32000 : 90000,
        });
      } catch {
        job = null;
      }
      if (!job) return;
      const [w, h] = [width, height];
      const more = layout && extraDotsRef.current ? extraDotsRef.current(layout, renderer.kind) : null;
      Promise.all([builder.name(job), more?.catch(() => null)]).then(([result, added]) => {
        if (disposed || mine !== version) return;
        extra = added ?? null;
        targets = extra ? withExtra(result, extra) : result;
        sim.setTargets(targets, w, h, spawn);
        // setTargets clears the simulation's hover; re-apply a live one. The
        // titles are rebuilt for these dots, so their looks start hidden.
        if (morphTo >= 0) sim.hoverIcon(morphTo);
        applyBeat();
        morph.fill(0);
        uploadTargets();
        onIconLayoutRef.current?.(targets.icons);
        if (builder.background) scheduleTitles(mine, TITLE_GAP_MS);
        else titlesPending = mine;
        wake();
      });
    };

    // Paint each icon's title and have it dealt from the current dots.
    const scheduleTitles = (mine: number, delay: number) => {
      window.clearTimeout(titleTimer);
      titleAttrs.length = 0;
      titleHomes.length = 0;
      let next = 0;
      const apply = (index: number, built: TitleTargets | null) => {
        if (disposed || mine !== version || !built || !targets) return;
        // Titles are dealt from the name's own dots; the extra ones stay as they are.
        const title =
          extra && built.home.length < targets.count * 2
            ? { home: cat(extra.home, built.home), attrs: cat(extra.attrs, built.attrs) }
            : built;
        sim.setTitle(index, title.home);
        renderer?.setTitle(index, title.attrs, targets.count);
        titleAttrs[index] = title.attrs;
        titleHomes[index] = title.home;
      };
      const step = () => {
        const spec = titlesRef.current[next];
        const basis = targets?.basis;
        if (disposed || mine !== version || !spec || !basis || next >= MAX_TITLES) return;
        const index = next++;
        // Words around the name were built with it; others are dealt now.
        if ("after" in spec) apply(index, targets?.decor ?? null);
        else builder.title(prepareTitle(basis, spec.lines, index)).then((title) => apply(index, title));
        titleTimer = window.setTimeout(step, TITLE_GAP_MS);
      };
      titleTimer = window.setTimeout(step, delay);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!renderer || !targets) return;
      // (Not "settled": a hovered icon's ripple would hold its own title back.)
      if (titlesPending && !sim.entering && !sim.holding) {
        scheduleTitles(titlesPending, 0);
        titlesPending = 0;
      }

      const quiet =
        now - lastInput > IDLE_AFTER_MS && !sim.holding && !sim.entering && sim.peakSpeed < SETTLED_SPEED;
      if (quiet && motionQuery.matches && !dirty) {
        // Reduced motion: nothing drifts, so once settled there is nothing to draw.
        stop();
        return;
      }
      // Idle: the gentle drift only needs ~30 fps and a coarser step.
      if (quiet && !dirty && last && now - last < IDLE_FRAME_MS) return;

      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      // Ease each title's look toward shown (the wanted one) or hidden.
      const blend = 1 - Math.exp(-dt / MORPH_TIME);
      for (let k = 0; k < MAX_TITLES; k++) {
        const target = k === morphTo && titleAttrs[k] ? 1 : 0;
        const gap = target - morph[k];
        if (gap === 0) continue;
        dirty = true;
        morph[k] = Math.abs(gap) < 0.002 ? target : morph[k] + gap * blend;
      }
      // Draw the newest finished positions, then ask for the next step; with
      // the simulation in a worker, it computes while this frame displays.
      const done = sim.take();
      if (done) drawnCount = done.count;
      // Right after a rebuild there are no positions yet: issue nothing, so
      // the last frame stays up instead of a cleared one.
      if ((done || dirty) && drawnCount > 0) {
        renderer.setMorph(morph);
        renderer.draw(done ? done.pos : null, drawnCount);
        dirty = false;
      }
      if (done) sim.release(done);
      sim.request(dt, quiet);
    };

    function start() {
      if (raf || document.hidden || disposed || contextLost) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    const wake = () => {
      lastInput = performance.now();
      start();
    };

    // While a title that only adds words around the name shows (About's "?"),
    // the name itself beats, so the hover reads clearly. The extra dots (the
    // portrait) stay still.
    const applyBeat = () => {
      const spec = morphTo >= 0 ? titlesRef.current[morphTo] : undefined;
      sim.setBeat(!!spec && "after" in spec, extra?.count ?? 0);
    };

    renderer = createDotRenderer(canvas);
    sizeCanvas();

    const onFontReady = () => {
      if (disposed) return;
      fontReady = true;
      // Arriving out of a hyperspace jump, the jump was the entrance: start in place.
      build(motionQuery.matches || isLanding() ? "home" : "enter");
    };
    // Build even if the font fails to load; the fallback face still reads.
    document.fonts.load(`${fontWeight ?? 400} 100px ${fontFamily}`).then(onFontReady, onFontReady);

    handleRef.current = {
      pulse(x, y) {
        sim.pulse(x, y);
        wake();
      },
      hoverIcon(index) {
        sim.hoverIcon(index);
        morphTo = index ?? -1;
        applyBeat();
        wake();
      },
    };

    const onResize = () => {
      sizeCanvas();
      wake();
      window.clearTimeout(rebuildTimer);
      // A resize before the first build lands keeps its fly-in.
      rebuildTimer = window.setTimeout(() => build(targets || motionQuery.matches ? "home" : "enter"), 120);
    };

    // devicePixelRatio changes (moving between displays) don't always fire resize.
    let dprQuery: MediaQueryList | null = null;
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener("change", onDprChange);
    };
    function onDprChange() {
      sizeCanvas();
      wake();
      watchDpr();
    }
    watchDpr();

    const onPointerMove = (e: PointerEvent) => {
      if (activePointer !== null && e.pointerId !== activePointer) return;
      const dt = lastPointerTime ? (e.timeStamp - lastPointerTime) / 1000 : 0;
      lastPointerTime = e.timeStamp;
      sim.pointerMove(e.clientX, e.clientY, dt);
      wake();
    };
    const onPointerDown = (e: PointerEvent) => {
      // One finger drives the hold; extra touches are ignored.
      if (e.button !== 0 || activePointer !== null) return;
      activePointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      lastPointerTime = 0;
      sim.pointerMove(e.clientX, e.clientY, 0);
      sim.holdStart(e.clientX, e.clientY);
      wake();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      sim.holdEnd();
      if (e.pointerType !== "mouse") sim.pointerLeave();
      wake();
    };
    const onPointerLeave = () => {
      if (activePointer === null) sim.pointerLeave();
    };

    const onVisibility = () => (document.hidden ? stop() : wake());
    const onMotionChange = () => {
      sim.setReducedMotion(motionQuery.matches);
      wake();
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      stop();
    };
    const onContextRestored = () => {
      contextLost = false;
      renderer = createDotRenderer(canvas);
      sizeCanvas();
      uploadTargets();
      titleAttrs.forEach((attrs, k) => attrs && targets && renderer?.setTitle(k, attrs, targets.count));
      wake();
    };

    // The dots at home (or in whichever title shows), for a page transition to launch from.
    const releaseSource = registerDotSource(() => {
      if (!targets || drawnCount === 0) return null;
      let shown = -1;
      for (let k = 0; k < MAX_TITLES; k++) if (morph[k] > 0.5) shown = k;
      const home = (shown >= 0 && titleHomes[shown]) || targets.home;
      const attrs = (shown >= 0 && titleAttrs[shown]) || targets.attrs;
      // The extra dots too, even behind their picture: it breaks up into them.
      return { pos: home, attrs, count: targets.count };
    });

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibility);
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      disposed = true;
      stop();
      window.clearTimeout(rebuildTimer);
      window.clearTimeout(titleTimer);
      releaseSource();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", onMotionChange);
      dprQuery?.removeEventListener("change", onDprChange);
      handleRef.current = IDLE_HANDLE;
      renderer?.dispose();
      sim.dispose();
      builder.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 h-full w-full touch-none select-none"
    />
  );
}
