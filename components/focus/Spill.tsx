"use client";

import { useEffect, useRef } from "react";
import s from "./focus.module.css";

// Canvas pixels are this many CSS pixels: the light is soft, so a coarse
// field, smoothed as the browser scales it up, is all it needs.
const CELL = 12;
// The light's spread (its blur's sigma), in frame heights: it grows with the
// sheet's depth, and faster the further out it is, so close to focus each
// frame's colour stays near it and far out they merge into one wash. At rest
// on the focus line it hides under the frames, and it fades in over the
// first RAMP of depth, so in focus there is none at all.
const SPREAD = 0.22;
const SPREAD_FAR = 0.4;
const SHARP = 4;
const RAMP = 0.25;
// A frame with less colour than this (in oklch chroma) spills none: the black
// and white ones add no light, so the wash is never grey.
const GREY = 0.008;
const FULL = 0.028;

// How the light reads on each paper: its lightness, the most chroma a frame
// may carry, how far a frame's own chroma is pushed toward it, and its
// strongest opacity.
const SCHEMES = {
  light: { l: 0.72, chroma: 0.15, gain: 5, alpha: 0.45 },
  dark: { l: 0.6, chroma: 0.13, gain: 5, alpha: 0.55 },
};

// When the light may show at all: the same conditions as the colour of soft
// type. The canvas is hidden in CSS under any other; this stops the drawing.
const ALLOWED = "(prefers-reduced-motion: no-preference) and (prefers-contrast: no-preference) and (not (forced-colors: active))";

// An ordered dither for the light's opacity, so its long fade never steps
// into visible contours at 8 bits. Fixed to the screen, so it never shimmers.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);

type Rgb = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A frame's tone as the light it gives on this paper: linear RGB, and its strength. */
function light(hex: string, scheme: (typeof SCHEMES)["light"]): { rgb: Rgb; weight: number } {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(A, B);
  const hue = Math.atan2(B, A);
  // Its hue, at the scheme's lightness, with its colour drawn out.
  const c = Math.min(scheme.chroma, chroma * scheme.gain);
  const [L, a, bb] = [scheme.l, c * Math.cos(hue), c * Math.sin(hue)];
  const l2 = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m2 = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s2 = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const rgb: Rgb = [
    4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
    -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
    -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2,
  ].map((v) => Math.max(0, Math.min(1, v))) as Rgb;
  return { rgb, weight: Math.max(0, Math.min(1, (chroma - GREY) / (FULL - GREY))) };
}

// The share of a blurred edge-to-edge span [lo, hi] that lands at x.
function erf(x: number) {
  const sign = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
const span = (lo: number, hi: number, x: number, sigma: number) =>
  0.5 * (erf((hi - x) / (sigma * Math.SQRT2)) - erf((lo - x) / (sigma * Math.SQRT2)));

/**
 * The colour of the work, out of focus. A photograph out of focus does not
 * vanish; its light spreads into a soft disc. So while the contact sheet is
 * off the focus line, each frame's own colour (its tone) spills onto the
 * paper around it, spread by how far out of focus the sheet is: a faint
 * warmth rising from below the opening frame, swelling as the sheet nears,
 * gathering back into the frames as it comes into focus, and lingering
 * above it after. The black and white frames give none.
 *
 * One fixed canvas behind everything, drawn only while the page moves. It
 * never covers type or a photograph: the frames are opaque, and the light
 * is a few percent at most. Pulled sharp by the pointer or keyboard, the
 * sheet's light gathers in too. Without JavaScript, with reduced motion,
 * more contrast or forced colours, there is none.
 */
export function Spill({ tones }: { tones: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const sheet = document.querySelector<HTMLElement>("[data-sheet]");
    const ctx = el?.getContext("2d");
    if (!el || !sheet || !ctx) return;
    const allowed = window.matchMedia(ALLOWED);
    const dark = window.matchMedia("(prefers-color-scheme: dark)");

    let lights = tones.map((t) => light(t, SCHEMES.light));
    const scheme = () => {
      const chosen = dark.matches ? SCHEMES.dark : SCHEMES.light;
      lights = tones.map((t) => light(t, chosen));
      return chosen;
    };
    let current = scheme();
    // In development, ?spill=2 (or any multiple) scales the light, to judge it.
    const boost =
      process.env.NODE_ENV !== "production" ? Number(new URLSearchParams(window.location.search).get("spill")) || 1 : 1;

    // The sheet's place in the document, untouched by its tilt; and the
    // canvas's own box, which is the viewport less any classic scroll bar.
    let box = { left: 0, top: 0, width: 0, height: 0 };
    let view = { width: 0, height: 0 };
    let image: ImageData | null = null;
    const measure = () => {
      let left = 0;
      let top = 0;
      for (let node: HTMLElement | null = sheet; node; node = node.offsetParent as HTMLElement | null) {
        left += node.offsetLeft;
        top += node.offsetTop;
      }
      box = { left, top, width: sheet.offsetWidth, height: sheet.offsetHeight };
      view = { width: el.clientWidth, height: el.clientHeight };
      const W = Math.max(1, Math.ceil(view.width / CELL));
      const H = Math.max(1, Math.ceil(view.height / CELL));
      // Sizing a canvas clears it, so only when the size really changes.
      if (!image || W !== el.width || H !== el.height) {
        el.width = W;
        el.height = H;
        image = ctx.createImageData(W, H);
      }
    };

    let last = "";
    let frame = 0;
    const draw = () => {
      frame = 0;
      if (!image || !allowed.matches) return;
      const y = window.scrollY;
      // Pulled sharp by the pointer or the keyboard (--sharp), the sheet's
      // light gathers back in with its blur.
      const sharp = parseFloat(getComputedStyle(sheet).getPropertyValue("--sharp")) || 0;
      const depth = Math.abs(parseFloat(sheet.style.getPropertyValue("--d")) || 0) * (1 - sharp);
      const key = `${y}|${depth.toFixed(4)}|${el.width}|${el.height}`;
      // Nothing moved: rest.
      if (key === last) return;
      last = key;

      const { width: W, height: H, data } = image;
      const sigma = SHARP + view.height * depth * (SPREAD + SPREAD_FAR * depth);
      const strength = Math.min(1, depth / RAMP) * current.alpha * boost;
      const top = box.top - y;
      // Out of reach of the frame: clear, and wait.
      if (top - 3 * sigma > view.height || top + box.height + 3 * sigma < 0) {
        data.fill(0);
        ctx.putImageData(image, 0, 0);
        frame = requestAnimationFrame(draw);
        return;
      }

      // The sheet is five frames across and four down, edge to edge, so each
      // frame's light is a column's spread times a row's. Each canvas pixel
      // samples the centre of the patch of the view it is stretched over.
      const cols = 5;
      const rows = Math.ceil(lights.length / cols);
      const fw = box.width / cols;
      const fh = box.height / rows;
      const sx = view.width / W;
      const sy = view.height / H;
      const across = Array.from({ length: cols }, (_, c) =>
        Float32Array.from({ length: W }, (_, x) => span(box.left + c * fw, box.left + (c + 1) * fw, (x + 0.5) * sx, sigma)),
      );
      const down = Array.from({ length: rows }, (_, r) =>
        Float32Array.from({ length: H }, (_, py) => span(top + r * fh, top + (r + 1) * fh, (py + 0.5) * sy, sigma)),
      );

      for (let py = 0; py < H; py++) {
        for (let x = 0; x < W; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let i = 0; i < lights.length; i++) {
            const { rgb, weight } = lights[i];
            if (!weight) continue;
            const w = weight * across[i % cols][x] * down[Math.floor(i / cols)][py];
            r += rgb[0] * w;
            g += rgb[1] * w;
            b += rgb[2] * w;
            a += w;
          }
          const o = (py * W + x) * 4;
          if (a < 1e-4) {
            data[o + 3] = 0;
            continue;
          }
          data[o] = Math.round(toGamma(r / a) * 255);
          data[o + 1] = Math.round(toGamma(g / a) * 255);
          data[o + 2] = Math.round(toGamma(b / a) * 255);
          data[o + 3] = Math.floor(Math.min(1, a * strength) * 255 + BAYER[(py & 3) * 4 + (x & 3)]);
        }
      }
      ctx.putImageData(image, 0, 0);
      // The sheet's depth eases on after the scroll stops, and its pull to
      // sharp transitions: follow either to rest.
      frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // Resized: drawn again at once, so the cleared canvas is never shown.
    const onResize = () => {
      measure();
      last = "";
      cancelAnimationFrame(frame);
      draw();
    };
    const onScheme = () => {
      current = scheme();
      last = "";
      wake();
    };
    // Reduced motion, more contrast or forced colours switched on: CSS has
    // already hidden the canvas; stop drawing and clear it.
    const onAllowed = () => {
      last = "";
      if (allowed.matches) return wake();
      cancelAnimationFrame(frame);
      frame = 0;
      ctx.clearRect(0, 0, el.width, el.height);
    };

    const resized = new ResizeObserver(onResize);
    measure();
    wake();
    resized.observe(document.body);
    resized.observe(el);
    window.addEventListener("scroll", wake, { passive: true });
    const pulls = ["pointerenter", "pointerleave", "focusin", "focusout", "transitionrun"] as const;
    for (const type of pulls) sheet.addEventListener(type, wake);
    dark.addEventListener("change", onScheme);
    allowed.addEventListener("change", onAllowed);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("scroll", wake);
      for (const type of pulls) sheet.removeEventListener(type, wake);
      dark.removeEventListener("change", onScheme);
      allowed.removeEventListener("change", onAllowed);
    };
  }, [tones]);

  return <canvas ref={canvas} className={s.spill} aria-hidden="true" />;
}
