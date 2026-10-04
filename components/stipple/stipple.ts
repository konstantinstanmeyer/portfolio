// Turns rasterised shapes into stipple targets: each mask is inflated into a
// puffy height field, lit from the top-right, and dots are scattered with a
// density that follows the shading, like hand stippling: dark = dense for ink
// on paper, lit = dense for light dots on a dark ground.
//
// Everything here is pure computation (no DOM), so it can run in a worker;
// raster.ts paints the masks it starts from.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StippleTargets {
  count: number;
  /** Home positions, interleaved [x0, y0, x1, y1, ...] in CSS px. */
  home: Float32Array;
  /** Per-dot [diameter (CSS px), opacity] pairs. */
  attrs: Float32Array;
  /** Per-dot owner: 0 = the name, i + 1 = icon i. */
  group: Uint8Array;
  /** Size of the rendered name block in CSS px, for scaling interactions. */
  blockWidth: number;
  blockHeight: number;
  /** Where each icon was drawn, in CSS px, for overlaying its link. */
  icons: Rect[];
  /** Signed distance to the icons' edges, so hovered dots can flow along them. */
  iconField: ShapeField | null;
  /** How the name was set, so titles can be set to match (null when empty). */
  basis: NameBasis | null;
}

export interface NameBasis {
  fontFamily: string;
  fontWeight: string | number;
  fontPx: number;
  stacked: boolean;
  maxWidth: number;
  /** Centre of the name block, in CSS px. */
  centerX: number;
  centerY: number;
  areaPerDot: number;
  dotSize: number;
  glow: boolean;
  seed: number;
}

/** Where every dot goes, and how it looks, while a title stands in for the name. */
export interface TitleTargets {
  home: Float32Array;
  /** Per-dot [size, opacity]; spare name dots get opacity 0. */
  attrs: Float32Array;
}

/**
 * A smoothed signed-distance grid (positive inside, in grid px). Its level
 * lines run parallel to every stroke, so moving along them keeps a dot on
 * the shape.
 */
export interface ShapeField {
  sdf: Float32Array;
  w: number;
  h: number;
  /** Grid px per CSS px, and the CSS position of the grid's corner. */
  scale: number;
  x: number;
  y: number;
}

/** A rasterised shape: coverage 0–1 per mask pixel, and where it sits. */
export interface Mask {
  coverage: Float32Array;
  w: number;
  h: number;
  /** Mask pixels per CSS px, and the CSS position of the mask's corner. */
  scale: number;
  x: number;
  y: number;
}

/** The name and icon masks plus the layout facts needed to finish them. */
export interface NameJob {
  name: Mask;
  icons: Mask | null;
  iconRects: Rect[];
  width: number;
  maxParticles: number;
  blockWidth: number;
  blockHeight: number;
  /** The basis minus what finishing works out (density and dot size). */
  basis: Omit<NameBasis, "areaPerDot" | "dotSize">;
}

/** One title's mask, set to stand in for the name. */
export interface TitleJob {
  index: number;
  mask: Mask;
  fontPx: number;
}

// Average CSS px² of fully-dark area per dot at a 200px font size. Lower =
// denser; smaller type gets proportionally denser, finer dots.
const AREA_PER_DOT = 0.9;
const INF = 1e20;
// Light-on-dark shading: ambient, rim light, lit faces, crease occlusion.
const GLOW_BASE = 0.17;
const GLOW_RIM = 0.4;
const GLOW_LIT = 0.6;
const GLOW_OCCLUDE = 0.4;
// Narrow gaps: how hemmed in a point must be to count, and how much the
// strokes beside it thin (as a raise of the silhouette threshold).
const GAP_FROM = 0.45;
const GAP_TO = 0.75;
const GAP_THIN = 0.2;
// Toward and past the edges, dots fade to this share of their opacity and size.
const EDGE_ALPHA = 0.22;
const EDGE_SIZE = 0.7;
// Name dots a title doesn't need drift out by this factor (about its centre)
// plus a little jitter while they fade.
const SPARE_SPREAD = 1.08;
const SPARE_JITTER = 0.06; // in font sizes

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Felzenszwalb–Huttenlocher 1-D squared distance transform. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Euclidean distance from every cell to the nearest cell where `site` is true. */
function distanceField(site: Uint8Array, w: number, h: number): Float32Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = site[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Separable box blur, in place. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): void {
  if (r < 1) return;
  const tmp = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / span;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc / span;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Approximate Gaussian blur: `passes` box blurs of the given total radius. */
function blurred(src: Float32Array, w: number, h: number, radius: number, passes: number): Float32Array {
  const out = Float32Array.from(src);
  const r = Math.max(1, Math.round(radius / Math.sqrt(passes)));
  for (let p = 0; p < passes; p++) boxBlur(out, w, h, r);
  return out;
}

/** Bilinear sample of a w×h grid, clamped at the borders. */
function sample(grid: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(w - 1.001, Math.max(0, x));
  const cy = Math.min(h - 1.001, Math.max(0, y));
  const x0 = cx | 0;
  const y0 = cy | 0;
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * w + x0;
  const top = grid[i] + (grid[i + 1] - grid[i]) * fx;
  const bottom = grid[i + w] + (grid[i + w + 1] - grid[i + w]) * fx;
  return top + (bottom - top) * fy;
}

/** Smooth value noise in [0, 1], used to break up the stipple density. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const hash = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi) + (hash(xi + 1, yi) - hash(xi, yi)) * sx;
  const b = hash(xi, yi + 1) + (hash(xi + 1, yi + 1) - hash(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

interface Piece {
  field: ShapeField | null;
  /** 1 deep inside the shape, falling toward 0 past its edge: dots fade and shrink with it. */
  fade: Float32Array;
  darkness: Float32Array;
  total: number;
  w: number;
  h: number;
  /** Mask pixels per CSS px. */
  scale: number;
  /** CSS position of the mask's top-left corner. */
  x: number;
  y: number;
}

/** Inflates and shades a mask into a stipple-density map. */
function shadeMask(mask: Mask, glow: boolean, withField = false): Piece {
  const { coverage, w, h, scale, x, y } = mask;
  const size = w * h;
  const outside = new Uint8Array(size);
  for (let i = 0; i < size; i++) outside[i] = coverage[i] < 0.5 ? 1 : 0;

  // Stroke half-width, from the deepest point inside the shape.
  let radius = 1;
  for (const d of distanceField(outside, w, h)) if (d > radius) radius = d;

  // Make the forms lumpy, like hand-drawn balloon lettering: warp them
  // gently and let the stroke weight swell and thin along their length.
  const soft = blurred(coverage, w, h, radius * 0.14, 2);
  // How hemmed in by ink each point is. Narrow gaps (the openings of an "s",
  // the eye of an "e") read high here, so the strokes beside them thin a
  // little and the gap stays open instead of filling with dots.
  const hemmed = blurred(coverage, w, h, radius * 1.4, 2);
  const tight = new Float32Array(size);
  for (let i = 0; i < size; i++) tight[i] = smoothstep(GAP_FROM, GAP_TO, hemmed[i]);
  const warpFreq = 1 / (radius * 3.2);
  const warpAmp = radius * 0.28;
  const lumpFreq = 1 / (radius * 2.4);
  const shape = new Float32Array(size);
  const shapeOutside = new Uint8Array(size);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      const wx = (valueNoise(xx * warpFreq, yy * warpFreq + 17.1) - 0.5) * 2 * warpAmp;
      const wy = (valueNoise(xx * warpFreq + 41.7, yy * warpFreq) - 0.5) * 2 * warpAmp;
      const v = sample(soft, w, h, xx + wx, yy + wy);
      const level =
        0.56 + (valueNoise(xx * lumpFreq + 5.5, yy * lumpFreq + 9.2) - 0.5) * 0.22 + GAP_THIN * tight[i];
      shape[i] = smoothstep(level - 0.06, level + 0.06, v);
      shapeOutside[i] = shape[i] < 0.5 ? 1 : 0;
    }
  }

  // Inflate each stroke into a rounded tube, puffing some parts more than
  // others, then soften so the surface reads as one continuous skin.
  const depth = distanceField(shapeOutside, w, h);
  let shapeRadius = 1;
  for (let i = 0; i < size; i++) if (depth[i] > shapeRadius) shapeRadius = depth[i];
  const puffFreq = 1 / (radius * 3);
  const height = new Float32Array(size);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      if (!depth[i]) continue;
      const t = Math.min(depth[i] / shapeRadius, 1);
      const puff = 0.7 + 0.6 * valueNoise(xx * puffFreq + 23.9, yy * puffFreq + 2.2);
      height[i] = shapeRadius * Math.sqrt(1 - (1 - t) * (1 - t)) * puff;
    }
  }
  const surface = blurred(height, w, h, radius * 0.3, 2);
  // How much ink surrounds each point; creases and inner curves pool darker.
  const crowd = blurred(shape, w, h, radius * 2.2, 2);
  // Faint spray just past the edge.
  const spray = blurred(shape, w, h, radius * 0.25, 2);
  // How far inside the silhouette a point sits, softly: the dots fade toward
  // the edges like in hand stippling instead of stopping at a hard outline.
  const inset = blurred(shape, w, h, radius * 0.6, 2);
  const fade = new Float32Array(size);
  for (let i = 0; i < size; i++) fade[i] = smoothstep(0.12, 0.85, inset[i]);

  const lightTilt = 1 / (radius * 9);
  const blotch = 1 / (radius * 4.5);
  const grain = 1 / (radius * 1.2);
  const darkness = new Float32Array(size);
  let total = 0;
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      const cover = shape[i];
      const halo = spray[i];
      if (cover < 0.01 && halo < 0.02) continue;

      const gx = (surface[i + 1] - surface[i - 1]) * 0.5;
      const gy = (surface[i + w] - surface[i - w]) * 0.5;
      const nz = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      // Light from the upper right; its angle drifts slowly across the shape.
      const az = -0.95 + (valueNoise(xx * lightTilt, yy * lightTilt + 7.3) - 0.5) * 1.4;
      const lx = Math.cos(az) * 0.78;
      const ly = Math.sin(az) * 0.78;
      const lambert = Math.min(1, Math.max(0, (-gx * lx - gy * ly + 0.62) * nz));
      const shade = 1 - lambert;
      // Surfaces turning away from the viewer gather dots on every side, so
      // each form keeps its outline; the light decides which side is heavier.
      const rim = Math.pow(1 - nz, 1.3);
      const pooled = smoothstep(0.4, 0.85, crowd[i]);

      // Ink pools in shadow and in creases; light dots crowd onto lit faces,
      // edge on as a rim light, and thin out where the creases occlude.
      const inner = glow
        ? (GLOW_BASE + GLOW_RIM * rim + GLOW_LIT * lambert * lambert) * (1 - GLOW_OCCLUDE * pooled)
        : 0.08 + 0.5 * rim + 0.42 * shade * shade + 0.22 * pooled;
      const tone = glow ? lambert : shade;
      // The spray past the edge stays out of narrow gaps.
      let d = cover * inner + (1 - cover) * (1 - tight[i]) * 0.1 * smoothstep(0.05, 0.5, halo) * (0.4 + tone);

      // Soft blotches + fine grain keep the texture from feeling mechanical.
      d *= 0.78 + 0.32 * valueNoise(xx * blotch + 3.1, yy * blotch);
      d *= 0.88 + 0.24 * valueNoise(xx * grain, yy * grain + 11.7);
      d = Math.min(0.95, d);
      darkness[i] = d;
      total += d;
    }
  }
  let field: ShapeField | null = null;
  if (withField) {
    const inside = new Uint8Array(size);
    for (let i = 0; i < size; i++) inside[i] = shapeOutside[i] ? 0 : 1;
    const away = distanceField(inside, w, h);
    const sdf = new Float32Array(size);
    for (let i = 0; i < size; i++) sdf[i] = depth[i] - away[i];
    // Round off the ridge along each stroke's centre so the flow turns smoothly.
    field = { sdf: blurred(sdf, w, h, radius * 0.35, 2), w, h, scale, x, y };
  }
  return { darkness, total, w, h, scale, x, y, field, fade };
}

function nearestIcon(rects: Rect[], x: number): number {
  let best = 0;
  for (let i = 1; i < rects.length; i++) {
    const d = Math.abs(rects[i].left + rects[i].width / 2 - x);
    if (d < Math.abs(rects[best].left + rects[best].width / 2 - x)) best = i;
  }
  return best;
}

const EMPTY: StippleTargets = {
  count: 0,
  home: new Float32Array(0),
  attrs: new Float32Array(0),
  group: new Uint8Array(0),
  blockWidth: 0,
  blockHeight: 0,
  icons: [],
  iconField: null,
  basis: null,
};

export const EMPTY_TARGETS = EMPTY;

/** Shades the name and icon masks and scatters the dots, in reading order. */
export function finishName(job: NameJob): StippleTargets {
  const rand = mulberry32(job.basis.seed);
  const { glow, fontPx } = job.basis;
  const pieces: Piece[] = [shadeMask(job.name, glow)];
  if (job.icons) pieces.push(shadeMask(job.icons, glow, true));
  const iconRects = job.iconRects;

  // One density for everything, so the icons share the name's texture.
  const sizeFactor = Math.min(1.15, Math.max(0.65, fontPx / 200));
  const areaPerDot = AREA_PER_DOT * sizeFactor * sizeFactor;
  const wantedPer = pieces.map((p) => p.total / (p.scale * p.scale) / areaPerDot);
  const wanted = Math.round(wantedPer.reduce((a, b) => a + b, 0));
  const count = Math.max(500, Math.min(job.maxParticles, wanted));
  // If the cap kicks in (huge screens), grow the dots to keep the same ink.
  const capGrowth = Math.min(1.6, Math.sqrt(Math.max(1, wanted / count)));
  const dotSize = Math.max(0.6, sizeFactor) * capGrowth;

  // Rejection-sample dots with probability proportional to darkness.
  const home = new Float32Array(count * 2);
  const attrs = new Float32Array(count * 2);
  const group = new Uint8Array(count);
  let placed = 0;
  pieces.forEach((piece, p) => {
    const quota = p === pieces.length - 1 ? count - placed : Math.round((count * wantedPer[p]) / Math.max(1, wanted));
    const end = Math.min(count, placed + quota);
    let guard = quota * 400;
    while (placed < end && guard-- > 0) {
      const px = rand() * piece.w;
      const py = rand() * piece.h;
      const cell = (py | 0) * piece.w + (px | 0);
      if (rand() >= piece.darkness[cell]) continue;
      const fade = piece.fade[cell];
      home[placed * 2] = piece.x + px / piece.scale;
      home[placed * 2 + 1] = piece.y + py / piece.scale;
      attrs[placed * 2] = (1.05 + rand() * 0.6) * dotSize * (EDGE_SIZE + (1 - EDGE_SIZE) * fade);
      attrs[placed * 2 + 1] = (0.7 + rand() * 0.25) * (EDGE_ALPHA + (1 - EDGE_ALPHA) * fade);
      // Icons share one mask; each dot belongs to the nearest icon slot.
      group[placed] = p === 0 ? 0 : nearestIcon(iconRects, home[placed * 2]) + 1;
      placed++;
    }
  });

  // Order left-to-right (counting sort by CSS column) so particle i keeps a
  // similar target across resizes, and the fly-in sweeps in reading order.
  const cols = Math.ceil(job.width) + 2;
  const columns = new Uint32Array(cols + 1);
  const column = new Uint32Array(placed);
  for (let i = 0; i < placed; i++) {
    const c = Math.min(cols - 1, Math.max(0, home[i * 2] | 0));
    column[i] = c;
    columns[c + 1]++;
  }
  for (let c = 0; c < cols; c++) columns[c + 1] += columns[c];
  const sortedHome = new Float32Array(placed * 2);
  const sortedAttrs = new Float32Array(placed * 2);
  const sortedGroup = new Uint8Array(placed);
  for (let i = 0; i < placed; i++) {
    const dst = columns[column[i]]++;
    sortedHome[dst * 2] = home[i * 2];
    sortedHome[dst * 2 + 1] = home[i * 2 + 1];
    sortedAttrs[dst * 2] = attrs[i * 2];
    sortedAttrs[dst * 2 + 1] = attrs[i * 2 + 1];
    sortedGroup[dst] = group[i];
  }

  return {
    count: placed,
    home: sortedHome,
    attrs: sortedAttrs,
    group: sortedGroup,
    blockWidth: job.blockWidth,
    blockHeight: job.blockHeight,
    icons: iconRects,
    iconField: pieces[1]?.field ?? null,
    basis: { ...job.basis, areaPerDot, dotSize },
  };
}

/**
 * Shades a title's mask and deals the name's dots onto it in reading order.
 * Name dots it doesn't need drift out a little and fade.
 */
export function finishTitle(targets: StippleTargets, job: TitleJob): TitleTargets | null {
  const b = targets.basis;
  if (!b || targets.count === 0) return null;
  const piece = shadeMask(job.mask, b.glow);

  // The name's dots, already in reading order.
  const names: number[] = [];
  for (let i = 0; i < targets.count; i++) if (targets.group[i] === 0) names.push(i);
  const need = Math.min(names.length, Math.round(piece.total / (piece.scale * piece.scale) / b.areaPerDot));

  // Sample the title's spots exactly as the name's were.
  const rand = mulberry32(b.seed + 7919 * (job.index + 1));
  const spots = new Float32Array(need * 4);
  let placed = 0;
  let guard = need * 400;
  while (placed < need && guard-- > 0) {
    const px = rand() * piece.w;
    const py = rand() * piece.h;
    const cell = (py | 0) * piece.w + (px | 0);
    if (rand() >= piece.darkness[cell]) continue;
    const fade = piece.fade[cell];
    spots[placed * 4] = piece.x + px / piece.scale;
    spots[placed * 4 + 1] = piece.y + py / piece.scale;
    spots[placed * 4 + 2] = (1.05 + rand() * 0.6) * b.dotSize * (EDGE_SIZE + (1 - EDGE_SIZE) * fade);
    spots[placed * 4 + 3] = (0.7 + rand() * 0.25) * (EDGE_ALPHA + (1 - EDGE_ALPHA) * fade);
    placed++;
  }
  // Reading order (counting sort by CSS column), so dots travel the short way across.
  const left = piece.x;
  const cols = Math.ceil(piece.w / piece.scale) + 2;
  const starts = new Uint32Array(cols + 1);
  for (let j = 0; j < placed; j++) starts[Math.min(cols - 1, (spots[j * 4] - left) | 0) + 1]++;
  for (let c = 0; c < cols; c++) starts[c + 1] += starts[c];
  const order = new Uint32Array(placed);
  for (let j = 0; j < placed; j++) order[starts[Math.min(cols - 1, (spots[j * 4] - left) | 0)]++] = j;

  const home = Float32Array.from(targets.home);
  const attrs = Float32Array.from(targets.attrs);
  // Every name dot starts out spare, then the title takes an even share in order.
  const jitter = SPARE_JITTER * job.fontPx;
  for (const i of names) {
    home[i * 2] = b.centerX + (home[i * 2] - b.centerX) * SPARE_SPREAD + (rand() - 0.5) * 2 * jitter;
    home[i * 2 + 1] = b.centerY + (home[i * 2 + 1] - b.centerY) * SPARE_SPREAD + (rand() - 0.5) * 2 * jitter;
    attrs[i * 2 + 1] = 0;
  }
  for (let j = 0; j < placed; j++) {
    const i = names[Math.floor(((j + 0.5) * names.length) / placed)];
    const s = order[j] * 4;
    home[i * 2] = spots[s];
    home[i * 2 + 1] = spots[s + 1];
    attrs[i * 2] = spots[s + 2];
    attrs[i * 2 + 1] = spots[s + 3];
  }
  return { home, attrs };
}
