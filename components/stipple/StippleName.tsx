"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { stippleFont } from "./font";
import { createBuilder } from "./build-client";
import type { GlyphId } from "./glyphs";
import { prepareName, prepareTitle } from "./raster";
import { createDotRenderer, type DotRenderer } from "./renderer";
import { createSim } from "./sim-client";
import type { Rect, StippleTargets } from "./stipple";

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

interface StippleNameProps {
  ref?: Ref<StippleHandle>;
  /** Icons stippled in a row under the name. */
  icons?: GlyphId[];
  /** For each icon, the title (as lines) that replaces the name while it's hovered. */
  titles?: string[][];
  /** Called with each icon's position whenever the layout is rebuilt. */
  onIconLayout?: (rects: Rect[]) => void;
}

export default function StippleName({ ref, icons = [], titles = [], onIconLayout }: StippleNameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<StippleHandle>(IDLE_HANDLE);
  const iconsRef = useRef(icons);
  const titlesRef = useRef(titles);
  const onIconLayoutRef = useRef(onIconLayout);

  useEffect(() => {
    iconsRef.current = icons;
    titlesRef.current = titles;
    onIconLayoutRef.current = onIconLayout;
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
    const morph = new Float32Array(3);
    let morphTo = -1;
    let titleTimer = 0;
    const titleAttrs: (Float32Array | null)[] = [];
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
      let job;
      try {
        job = prepareName({
          lines: LINES,
          icons: iconsRef.current,
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
      builder.name(job).then((result) => {
        if (disposed || mine !== version) return;
        targets = result;
        sim.setTargets(result, w, h, spawn);
        // setTargets clears the simulation's hover; re-apply a live one. The
        // titles are rebuilt for these dots, so their looks start hidden.
        if (morphTo >= 0) sim.hoverIcon(morphTo);
        morph.fill(0);
        uploadTargets();
        onIconLayoutRef.current?.(result.icons);
        if (builder.background) scheduleTitles(mine, TITLE_GAP_MS);
        else titlesPending = mine;
        wake();
      });
    };

    // Paint each icon's title and have it dealt from the current dots.
    const scheduleTitles = (mine: number, delay: number) => {
      window.clearTimeout(titleTimer);
      titleAttrs.length = 0;
      let next = 0;
      const step = () => {
        const lines = titlesRef.current[next];
        const basis = targets?.basis;
        if (disposed || mine !== version || !lines || !basis || next >= 3) return;
        const index = next++;
        builder.title(prepareTitle(basis, lines, index)).then((title) => {
          if (disposed || mine !== version || !title || !targets) return;
          sim.setTitle(index, title.home);
          renderer?.setTitle(index, title.attrs, targets.count);
          titleAttrs[index] = title.attrs;
        });
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
      for (let k = 0; k < 3; k++) {
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

    renderer = createDotRenderer(canvas);
    sizeCanvas();

    const onFontReady = () => {
      if (disposed) return;
      fontReady = true;
      build(motionQuery.matches ? "home" : "enter");
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
