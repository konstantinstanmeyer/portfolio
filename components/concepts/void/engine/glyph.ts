export const LIVE = 0;
export const DYING = 1;
export const FLYING = 2;

export interface Glyph {
  ch: string;
  cell: number;
  space: boolean;
  adv: number;
  phase: number;
  age: number;
  seed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  heat: number;
  flare: number;
  alpha: number;
  refl: number;
  floor: number;
  airborne: boolean;
  // Layout targets.
  tx: number;
  ty: number;
  ts: number;
  reflT: number;
  hidden: boolean;
  fade: number;
  // Departure: a cubic path into one letter of the name.
  target: number;
  delay: number;
  t: number;
  dur: number;
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
  s0: number;
  s1: number;
  delivered: boolean;
  // Previous frame, for long-exposure stamping.
  lx: number;
  ly: number;
  ls: number;
  lh: number;
}

export function makeGlyph(ch: string, cell: number, adv: number, seed: number): Glyph {
  return {
    ch,
    cell,
    space: cell < 0,
    adv,
    phase: LIVE,
    age: 0,
    seed,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 0,
    rot: 0,
    vr: 0,
    heat: 0,
    flare: 0,
    alpha: 1,
    refl: 1,
    floor: 0,
    airborne: false,
    tx: 0,
    ty: 0,
    ts: 0,
    reflT: 1,
    hidden: false,
    fade: 1,
    target: -1,
    delay: 0,
    t: 0,
    dur: 1,
    p0x: 0,
    p0y: 0,
    p1x: 0,
    p1y: 0,
    p2x: 0,
    p2y: 0,
    p3x: 0,
    p3y: 0,
    s0: 1,
    s1: 1,
    delivered: false,
    lx: 0,
    ly: 0,
    ls: 0,
    lh: 0,
  };
}

export function bezier(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

export function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
