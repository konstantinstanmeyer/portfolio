const INF = 1e20;

/** Scratch space for one square cell; reused across bakes. */
export class FieldScratch {
  readonly outer: Float64Array;
  readonly inner: Float64Array;
  readonly f: Float64Array;
  readonly z: Float64Array;
  readonly v: Uint16Array;
  readonly a: Float32Array;
  readonly b: Float32Array;

  constructor(readonly size: number) {
    const n = size * size;
    this.outer = new Float64Array(n);
    this.inner = new Float64Array(n);
    this.f = new Float64Array(size);
    this.z = new Float64Array(size + 1);
    this.v = new Uint16Array(size);
    this.a = new Float32Array(n);
    this.b = new Float32Array(n);
  }
}

// Felzenszwalb & Huttenlocher squared distance transform along one axis.
function edt1d(grid: Float64Array, offset: number, stride: number, n: number, s: FieldScratch) {
  const { f, v, z } = s;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let i = 0; i < n; i++) f[i] = grid[offset + i * stride];
  for (let q = 1, k = 0, p = 0; q < n; q++) {
    do {
      const r = v[k];
      p = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
    } while (p <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = p;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    grid[offset + q * stride] = f[r] + (q - r) * (q - r);
  }
}

function edt(grid: Float64Array, size: number, s: FieldScratch) {
  for (let x = 0; x < size; x++) edt1d(grid, x, size, size, s);
  for (let y = 0; y < size; y++) edt1d(grid, y * size, 1, size, s);
}

/**
 * Signed distance field from an alpha mask (0..1), using the partial
 * coverage of edge pixels for sub-pixel accuracy. Output: 0.5 on the edge,
 * rising inside, `spread` pixels per 0.5.
 */
export function signedField(alpha: Float32Array, out: Float32Array, spread: number, s: FieldScratch) {
  const size = s.size;
  const n = size * size;
  const { outer, inner } = s;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt(outer, size, s);
  edt(inner, size, s);
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    out[i] = Math.min(1, Math.max(0, 0.5 - d / (2 * spread)));
  }
}

function boxPass(src: Float32Array, dst: Float32Array, size: number, r: number, horizontal: boolean) {
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < size; line++) {
    const base = horizontal ? line * size : line;
    const step = horizontal ? 1 : size;
    let acc = 0;
    for (let i = 0; i <= r && i < size; i++) acc += src[base + i * step];
    for (let i = 0; i < size; i++) {
      dst[base + i * step] = acc * norm;
      const add = i + r + 1;
      const sub = i - r;
      if (add < size) acc += src[base + add * step];
      if (sub >= 0) acc -= src[base + sub * step];
    }
  }
}

/** Approximate gaussian (three box passes per axis). Result lands in `out`. */
export function blur(src: Float32Array, out: Float32Array, r: number, s: FieldScratch) {
  const size = s.size;
  const tmp = s.b;
  out.set(src);
  for (let k = 0; k < 3; k++) {
    boxPass(out, tmp, size, r, true);
    boxPass(tmp, out, size, r, false);
  }
}
