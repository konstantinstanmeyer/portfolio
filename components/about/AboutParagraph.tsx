"use client";

import { useEffect, useRef, useState } from "react";
import JumpLink from "@/components/hyperspace/JumpLink";
import { stippleFont } from "@/components/stipple/font";
import { defocus, DotStage, type StageTargets } from "@/components/stipple/stage";
import { buildSession, registerBuilds } from "@/components/stipple/build-session";
import { dotsOf, fontsReady, readRuns, scaleRuns, shrinkDots, stippleJob } from "@/components/stipple/text-dots";
import styles from "./about.module.css";

type State = "latent" | "drawn" | "failed";
type Piece = string | { text: string; href: string };

const PARAGRAPH: Piece[] = [
  "I'm Konstantin, a freelance developer who designs and builds applications and sites that just work, for businesses and for my own interests. Before I wrote my first line of code, I was ",
  { text: "composing frames", href: "/photography" },
  ". These days I run ",
  { text: "Myrtle Street Media", href: "https://www.myrtlestreetmedia.com" },
  ", a studio for local search and websites, and I'm building ",
  { text: "Intabulate", href: "https://intabulate.com" },
  ", which turns guitar audio into tab. Find me on ",
  { text: "GitHub", href: "https://github.com/konstantinstanmeyer" },
  " or ",
  { text: "LinkedIn", href: "https://www.linkedin.com/in/konstantin-stanmeyer/" },
  ", or head back ",
  { text: "home", href: "/" },
  ".",
];

// Type is shaded at this size (like the home page's name), then shrunk, so it keeps fine dots.
const SHADE_PX = 104;
// How far out of focus the words start, in font sizes (clamped, px).
const BLUR = 0.3;
// If no dots have drawn by then, the latent words take over in full ink.
const FALLBACK_MS = 8000;
// The 2D fallback draws every dot every frame; keep its set small.
const MAX_DOTS_2D = 12_000;

/** Each word is its own run, so the dots follow the browser's line breaks. */
function Words({ text }: { text: string }) {
  return text.split(/(\s+)/).map((word, i) =>
    /^\s*$/.test(word) ? (
      word && " "
    ) : (
      <span key={i} data-run="">
        {word}
        <i data-baseline="" className={styles.baseline} />
      </span>
    ),
  );
}

function PieceLink({ text, href }: { text: string; href: string }) {
  if (href.startsWith("/")) {
    return (
      <JumpLink href={href} className={styles.link}>
        <Words text={text} />
      </JumpLink>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={styles.link}>
      <Words text={text} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * The about page: one paragraph, set in the home page's stipple. The words
 * are real text laid out by CSS (and readable without JS or WebGL); the dots
 * are printed exactly over them, come into focus once, then drift on the same
 * air as the name.
 */
export default function AboutParagraph() {
  const rootRef = useRef<HTMLParagraphElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<State>("latent");

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const release = registerBuilds();
    let stage: DotStage | null = null;
    let disposed = false;
    let version = 0;
    let built = false;
    let focusTimer = 0;
    const fallback = window.setTimeout(() => setState((s) => (s === "drawn" ? s : "failed")), FALLBACK_MS);

    const build = async () => {
      if (!stage || disposed) return;
      const { width, height } = stage;
      if (!width || !height) return;
      const mine = ++version;
      const c = canvas.getBoundingClientRect();
      const runs = readRuns(root, c.left, c.top);
      if (!runs.length) return;
      const px = runs[0].px;
      const k = Math.max(1, SHADE_PX / px);
      const small = width < 700;
      const job = stippleJob(scaleRuns(runs, k), {
        width: width * k,
        maxDots: stage.kind === "2d" ? MAX_DOTS_2D : small ? 64_000 : 96_000,
        maskPixels: small ? 900_000 : 1_400_000,
      });
      if (!job) return;
      const targets = await buildSession((b) => b.name(job));
      if (disposed || mine !== version || !stage) return;
      const dots = shrinkDots(dotsOf(targets), k);
      const sharp: StageTargets = {
        count: dots.count,
        home: dots.home,
        attrs: dots.attrs,
        group: new Uint8Array(dots.count),
        icons: [],
        iconField: null,
        blockHeight: 0,
      };
      if (built || stage.reduced) {
        // A relayout re-flows the words, so the dots are placed outright
        // (matched by index, they'd fly across the paragraph).
        stage.clear();
        stage.setTargets(sharp);
      } else {
        // First time: out of focus, then racked into focus.
        const radius = Math.min(16, Math.max(6, px * BLUR));
        stage.setTargets({ ...sharp, home: defocus(dots.home, dots.count, radius, 0x9e37) });
        focusTimer = window.setTimeout(() => !disposed && stage?.moveTo(dots.home), 160);
      }
      built = true;
    };

    const run = () => {
      build().catch(() => {
        if (!disposed) setState("failed");
      });
    };

    stage = new DotStage(canvas, {
      pointer: "none",
      onSize: () => void fontsReady(`700 100px ${stippleFont.style.fontFamily}`).then(run),
      onDrawn: () => {
        window.clearTimeout(fallback);
        setState("drawn");
      },
    });

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
      <h1 className="sr-only">About Konstantin Stanmeyer</h1>
      <p ref={rootRef} className={`${stippleFont.className} ${styles.paragraph}`} data-state={state}>
        {PARAGRAPH.map((piece, i) =>
          typeof piece === "string" ? <Words key={i} text={piece} /> : <PieceLink key={i} {...piece} />,
        )}
        <canvas ref={canvasRef} aria-hidden="true" className={styles.canvas} />
      </p>
    </main>
  );
}
