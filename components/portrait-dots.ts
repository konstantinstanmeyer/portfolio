// The home page's portrait as dots: Konstantin behind a rangefinder, cut from
// his background by a matte (made once, offline, with Apple Vision's person
// and subject segmentation) and stippled from his tones (image-dots.ts). The
// dots join the name's in one simulation, so they drift, part, stir and bloom
// as the name's do.

import { imageDots, loadImage } from "./stipple/image-dots";
import type { Area } from "./stipple/raster";
import type { Dots } from "./stipple/stage";

/** The grayscale photo (the stipple's source) and its matte, and their cover crop. */
export const PORTRAIT = {
  tone: "/portrait/portrait-tone.jpg",
  matte: "/portrait/portrait-matte.png",
  posX: 0.5,
  posY: 0.36,
};

// The 2D fallback draws every dot every frame (the name's take 12k of its budget).
const MAX_DOTS_2D = 8_000;
// A resize within this factor rescales the dots already shaded; past it they're shaded afresh.
const RESCALE_LIMIT = 1.4;

let images: Promise<{ tone: HTMLImageElement; matte: HTMLImageElement }> | null = null;

/** The photo and its matte, loaded once. */
export function loadPortrait(): Promise<{ tone: HTMLImageElement; matte: HTMLImageElement }> {
  images ??= Promise.all([loadImage(PORTRAIT.tone), loadImage(PORTRAIT.matte)]).then(([tone, matte]) => ({
    tone,
    matte,
  }));
  images.catch(() => (images = null));
  return images;
}

// The last shading, in the frame's own coordinates.
let shaded: { dots: Dots; width: number; kind: string } | null = null;

/**
 * The portrait's dots for `area`, in page coordinates. The frame keeps its
 * aspect, so a modest resize is a pure scale of the last shading: the same
 * dots, in the same order, glide with it instead of being dealt anew.
 */
export async function portraitDots(area: Area, kind: "webgl" | "2d"): Promise<Dots> {
  const { tone, matte } = await loadPortrait();
  const { width, height } = area;
  const ratio = shaded ? width / shaded.width : 0;
  if (!shaded || shaded.kind !== kind || ratio > RESCALE_LIMIT || ratio < 1 / RESCALE_LIMIT) {
    const small = width < 420;
    const dots = imageDots(tone, {
      width,
      height,
      posX: PORTRAIT.posX,
      posY: PORTRAIT.posY,
      gamma: 1.1,
      edges: 0.3,
      areaPerDot: small ? 1.15 : 1.3,
      maxDots: kind === "2d" ? MAX_DOTS_2D : small ? 32_000 : 72_000,
      dotSize: small ? 1 : 1.1,
      opacity: small ? 1.18 : 1.25,
      // No brighter than the name at its brightest (on phones the name has fewer dots).
      highlight: small ? 0.69 : 0.77,
      // Only where the frame cuts him off (shoulders, arm) does he fade out.
      feather: 0.06,
      seed: 0x9e7a,
      matte,
      rim: 0.4,
      floor: 0.07,
    });
    shaded = { dots, width, kind };
  }
  const { dots } = shaded;
  const scale = width / shaded.width;
  const home = new Float32Array(dots.count * 2);
  for (let i = 0; i < dots.count; i++) {
    home[i * 2] = area.left + dots.home[i * 2] * scale;
    home[i * 2 + 1] = area.top + dots.home[i * 2 + 1] * scale;
  }
  return { count: dots.count, home, attrs: dots.attrs };
}
