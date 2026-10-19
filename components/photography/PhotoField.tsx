"use client";

import { useEffect, useRef, useState } from "react";
import JumpLink from "@/components/hyperspace/JumpLink";
import { buildSession, registerBuilds } from "@/components/stipple/build-session";
import { clusterDots } from "@/components/stipple/clusters";
import { stippleFont } from "@/components/stipple/font";
import { imageDots, loadImage } from "@/components/stipple/image-dots";
import { defocus, DotStage, type Dots, type StageTargets } from "@/components/stipple/stage";
import { dotsOf, fontsReady, readRuns, scaleRuns, shrinkDots, stippleJob } from "@/components/stipple/text-dots";
import styles from "./photo-field.module.css";

type State = "latent" | "drawn" | "failed";

// Grayscale copy of the photograph (2000 px wide): the dots' source.
const TONE = "/photography/parade-tone.jpg";
const ASPECT = 3024 / 1690;
const ALT =
  "A night parade in Bali drawn in dots: runners carry a giant demon effigy on a bamboo frame through coloured smoke, one man holding a smoke flare aloft.";
const CAPTION = ["Sharing", "more", "soon"];
// The caption's dots are dimmed to sit within the photograph's own light
// (its lit smoke, not its brightest highlights).
const CAPTION_LIGHT = 0.62;
// Type is shaded at this size, then shrunk, so it keeps fine dots.
const SHADE_PX = 104;
// How far out of focus the field starts (px).
const BLUR = 22;
const FOCUS_DELAY_MS = 160;
// If no dots have drawn by then, the caption shows in full ink.
const FALLBACK_MS = 8000;

// The photograph's dots at full size (a frame REF_WIDTH wide or more): the
// desktop look. In a narrower frame the dots get proportionally finer and
// denser, so the picture keeps its detail, down to dots MIN_DEVICE_DOT device
// pixels across (finer than that stops reading as dots).
const REF_WIDTH = 1100;
const DOT = 0.8;
const AREA_PER_DOT = 0.85;
const MIN_DEVICE_DOT = 1.2;
// How much of the finer dots' extra rim light is taken back (measured on screen).
const RIM_MATCH = 0.3;
// Finer dots are drawn on a finer canvas where the screen has the pixels.
const MAX_DPR = 3;
const MAX_DOTS = 170_000;
// A touch screen showing the photograph below full size draws more dots than
// it simulates: about as many move as the earlier version moved there (dots
// of OLD_AREA_* CSS px² apiece, at most OLD_MAX_*), each carrying a cluster of
// the finer dots (clusters.ts). Its analysis grid stays modest, so the build is short.
const MAX_DOTS_TOUCH = 100_000;
const MAX_GRID_TOUCH = 2;
const OLD_AREA_SMALL = 0.95;
const OLD_MAX_SMALL = 60_000;
const SIM_BUDGET_MIN = 6_000;
const MAX_CLUSTER = 8;
// The 2D fallback draws every dot itself: few, and as they always were.
const MAX_DOTS_2D = 10_000;

/**
 * Light a drawn dot gives beyond its disc (a WebGL point's soft one-pixel
 * rim), as a factor: tiny dots are mostly rim. `dot` is the nominal size
 * (CSS px), about 0.84 of it drawn on average.
 */
function rimFactor(dot: number, dpr: number): number {
  const r = 0.42 * dot * dpr;
  return 1 + 1 / (12 * r * r);
}

/** Dot size, density, opacity and grid for a photograph `width` CSS px wide. */
function sizing(width: number, dpr: number) {
  const dot = Math.max(DOT * Math.min(1, width / REF_WIDTH), Math.min(DOT, MIN_DEVICE_DOT / dpr));
  const k = dot / DOT;
  return {
    dotSize: dot,
    areaPerDot: AREA_PER_DOT * k * k,
    // The same light as the desktop dots on this screen: finer dots are relatively more rim.
    opacity: 1.1 * Math.pow(rimFactor(DOT, Math.min(2, dpr)) / rimFactor(dot, dpr), RIM_MATCH),
    maxGridScale: 1.25 / k,
  };
}

/** `a` followed by `b`. */
function join(a: Dots, b: Dots | null): Dots {
  if (!b || b.count === 0) return a;
  const home = new Float32Array((a.count + b.count) * 2);
  const attrs = new Float32Array((a.count + b.count) * 2);
  home.set(a.home.subarray(0, a.count * 2));
  home.set(b.home.subarray(0, b.count * 2), a.count * 2);
  attrs.set(a.attrs.subarray(0, a.count * 2));
  attrs.set(b.attrs.subarray(0, b.count * 2), a.count * 2);
  return { count: a.count + b.count, home, attrs };
}

/**
 * Photography: one photograph, drawn in fine dots, and a caption under it,
 * in the same dots. They drift on the home page's air and part and swirl
 * under the cursor as the name does (there's no press-and-hold here). The
 * photograph's frame and the caption are laid out by CSS; the dots are
 * printed over them on one canvas behind the page.
 */
export default function PhotoField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<State>("latent");

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    const caption = captionRef.current;
    if (!canvas || !frame || !caption) return;
    const release = registerBuilds();
    let stage: DotStage | null = null;
    let tone: HTMLImageElement | null = null;
    let disposed = false;
    let version = 0;
    let built = false;
    let focusTimer = 0;
    // The dots last placed (photograph and caption), and how many of them may
    // move (Infinity: all), halved each time the simulation can't keep up.
    let placed: Dots | null = null;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    let simBudget = Infinity;
    let lightness = 1;
    // The cluster size last used (MAX_CLUSTER: as light as it gets).
    let clusterSize = 1;
    const fallback = window.setTimeout(() => setState((s) => (s === "drawn" ? s : "failed")), FALLBACK_MS);

    /** The caption's dots, in the canvas's coordinates (null if it isn't laid out). */
    const captionDots = async (width: number): Promise<Dots | null> => {
      const c = canvas.getBoundingClientRect();
      const runs = readRuns(caption, c.left, c.top);
      if (!runs.length) return null;
      const k = Math.max(1, SHADE_PX / runs[0].px);
      const job = stippleJob(scaleRuns(runs, k), { width: width * k, maxDots: 14_000, maskPixels: 500_000 });
      if (!job) return null;
      const targets = await buildSession((b) => b.name(job));
      const dots = shrinkDots(dotsOf(targets), k);
      for (let i = 0; i < dots.count; i++) dots.attrs[i * 2 + 1] *= CAPTION_LIGHT;
      return dots;
    };

    const build = async () => {
      if (!stage || !tone || disposed) return;
      const { width, height } = stage;
      if (!width || !height) return;
      const mine = ++version;
      const c = canvas.getBoundingClientRect();
      const r = frame.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const shared = { width: r.width, height: r.height, posX: 0.5, posY: 0.5, gamma: 1.35, edges: 0.35 };
      let photo: Dots;
      // Below full size the dots get finer (on a finer canvas); on a touch
      // screen they're also drawn in clusters.
      const finer = stage.kind === "webgl" && r.width < REF_WIDTH;
      const light = finer && touch;
      simBudget = Infinity;
      if (stage.kind === "webgl") {
        stage.setMaxDpr(finer ? MAX_DPR : 2);
        const size = sizing(r.width, stage.pixelRatio);
        photo = imageDots(tone, {
          ...shared,
          ...size,
          maxGridScale: light ? Math.min(MAX_GRID_TOUCH, size.maxGridScale) : size.maxGridScale,
          maxDots: light ? MAX_DOTS_TOUCH : MAX_DOTS,
          feather: 0.035,
          seed: 0x0a0a,
          gridPixels: 720_000,
        });
        // Page transitions launch from these dots at their usual size.
        stage.setLaunchScale(DOT / size.dotSize);
        if (light) {
          // As many as the earlier version moved at this size.
          const small = r.width < 600;
          const old = (photo.count * size.areaPerDot) / (small ? OLD_AREA_SMALL : AREA_PER_DOT);
          simBudget = Math.min(small ? OLD_MAX_SMALL : MAX_DOTS, Math.round(old));
        }
      } else {
        const small = r.width < 600;
        photo = imageDots(tone, {
          ...shared,
          areaPerDot: small ? 0.95 : 0.85,
          maxDots: MAX_DOTS_2D,
          dotSize: small ? 0.85 : 0.8,
          opacity: 1.1,
          feather: 0.035,
          seed: 0x0a0a,
          gridPixels: small ? 260_000 : 720_000,
        });
      }
      for (let i = 0; i < photo.count; i++) {
        photo.home[i * 2] += r.left - c.left;
        photo.home[i * 2 + 1] += r.top - c.top;
      }
      const words = await captionDots(width).catch(() => null);
      if (disposed || mine !== version || !stage) return;
      placed = join(photo, words);
      // The caption's dots moved too in the earlier version.
      if (Number.isFinite(simBudget)) simBudget += words?.count ?? 0;
      const sharp = targetsFor(placed);
      // A new set of dots each time: placed outright, never matched by index.
      stage.clear();
      if (built || stage.reduced) {
        stage.setTargets(sharp);
      } else if (sharp.clusters) {
        // First time: out of focus, then racked sharp (each drawn dot, not each cluster).
        stage.setTargets(sharp);
        stage.focusPull(BLUR, 0x7a11);
      } else {
        // First time: out of focus, then racked sharp.
        stage.setTargets({ ...sharp, home: defocus(sharp.home, sharp.count, BLUR, 0x7a11) });
        window.clearTimeout(focusTimer);
        focusTimer = window.setTimeout(() => !disposed && stage?.moveTo(sharp.home), FOCUS_DELAY_MS);
      }
      built = true;
    };

    /** How many dots may move now. */
    const budget = () => (Number.isFinite(simBudget) ? Math.max(SIM_BUDGET_MIN, Math.floor(simBudget * lightness)) : Infinity);

    /** The stage's targets for `dots`: as they are, or in clusters if more than the budget may move. */
    const targetsFor = (dots: Dots): StageTargets => {
      const base = { group: new Uint8Array(0), icons: [], iconField: null, blockHeight: 230 };
      // (blockHeight 230 sets the cursor's reach to about the name's on the home page.)
      const most = budget();
      clusterSize = 1;
      if (dots.count <= most) return { ...dots, ...base, group: new Uint8Array(dots.count) };
      let size = Math.min(MAX_CLUSTER, Math.ceil(dots.count / most));
      let grouped = clusterDots(dots, size);
      while (grouped.carriers.count > most && size < MAX_CLUSTER) grouped = clusterDots(dots, ++size);
      clusterSize = size;
      const { carriers, clusters } = grouped;
      return { ...carriers, ...base, group: new Uint8Array(carriers.count), clusters };
    };

    /** A clustered set can't keep up: let half as many dots move, in bigger clusters. */
    const lighten = () => {
      if (!stage || !placed || disposed || budget() <= SIM_BUDGET_MIN || clusterSize >= MAX_CLUSTER) return;
      lightness /= 2;
      window.clearTimeout(focusTimer);
      stage.clear();
      stage.setTargets(targetsFor(placed));
    };

    const run = () => {
      build().catch(() => {
        if (!disposed) setState("failed");
      });
    };

    stage = new DotStage(canvas, {
      pointer: "lens",
      stir: true,
      rebuildOnDpr: true,
      onSlowSim: lighten,
      margin: "0px",
      onSize: () => void fontsReady(`700 100px ${stippleFont.style.fontFamily}`).then(run),
      onDrawn: () => {
        window.clearTimeout(fallback);
        setState("drawn");
      },
    });
    loadImage(TONE).then(
      (img) => {
        if (disposed) return;
        tone = img;
        void fontsReady(`700 100px ${stippleFont.style.fontFamily}`).then(run);
      },
      () => {
        if (!disposed) setState("failed");
      },
    );

    return () => {
      disposed = true;
      window.clearTimeout(fallback);
      window.clearTimeout(focusTimer);
      stage?.dispose();
      release();
    };
  }, []);

  return (
    <main className={styles.page}>
      <canvas ref={canvasRef} aria-hidden="true" className={styles.canvas} />
      <h1 className="sr-only">Photography</h1>
      <JumpLink href="/" className={styles.home}>
        ← home
      </JumpLink>
      <figure className={styles.figure} data-state={state}>
        <div ref={frameRef} role="img" aria-label={ALT} className={styles.frame} style={{ aspectRatio: ASPECT }} />
        <figcaption>
          <p ref={captionRef} className={`${stippleFont.className} ${styles.caption}`}>
            {CAPTION.map((word, i) => (
              <span key={word}>
                {i > 0 && " "}
                <span data-run="">
                  {word}
                  <i data-baseline="" className={styles.baseline} />
                </span>
              </span>
            ))}
          </p>
        </figcaption>
      </figure>
    </main>
  );
}
