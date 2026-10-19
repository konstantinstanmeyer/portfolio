// Colour presets. PALETTE is the one place the page's colours come from: the
// dot renderer, the stipple shading, and app/layout.tsx, which paints the
// first-paint background and theme colour and sets the --paper / --ink CSS
// variables behind the Tailwind `paper` / `ink` tokens (app/globals.css).

export interface Palette {
  /** Background. */
  paper: string;
  /** Dots. */
  ink: string;
  /** Light dots on a dark ground: the shading flips so lit faces gather the dots. */
  glow: boolean;
  /** Overlapping dots add up like light instead of layering like ink. */
  additive: boolean;
  /** Dot opacity and size trims that keep the visual weight equal across presets. */
  alpha: number;
  size: number;
}

export const PALETTES = {
  /** Near-white paper, black ink. */
  paper: { paper: "#fbfbf9", ink: "#121212", glow: false, additive: false, alpha: 1, size: 1 },
  /** Warm white motes on blue-black, like the smell simulator's particles. */
  night: { paper: "#07080a", ink: "#f2eadb", glow: true, additive: true, alpha: 1, size: 0.9 },
  /** Bone newsprint, warm black ink. */
  bone: { paper: "#ebe4d4", ink: "#1b1814", glow: false, additive: false, alpha: 1.04, size: 1 },
  /** International Klein Blue, chalk-white dots. */
  klein: { paper: "#0f2fa8", ink: "#f4f1ea", glow: true, additive: false, alpha: 1, size: 0.94 },
  /** Signal orange, near-black ink. */
  signal: { paper: "#ff5b1f", ink: "#170c07", glow: false, additive: false, alpha: 1.05, size: 1 },
} as const satisfies Record<string, Palette>;

export const PALETTE: Palette = PALETTES.night;

/** "#rrggbb" → [r, g, b] in 0–1. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
