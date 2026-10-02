const INF = 1e20;

/**
 * Signed distance field from an anti-aliased coverage mask (alpha channel of RGBA pixels),
 * after Felzenszwalb & Huttenlocher with sub-pixel edge seeding (as in Mapbox tiny-sdf).
 * Result is in output units (pixels / scale), positive outside the shape, clamped to ±spread.
 */
export function signedDistance(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  scale: number,
  spread: number,
): Float32Array {
  const n = w * h;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    if (a >= 1) {
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
    } else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }

  const size = Math.max(w, h);
  const f = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  edt(outer, w, h, f, v, z);
  edt(inner, w, h, f, v, z);

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / scale;
    out[i] = d < -spread ? -spread : d > spread ? spread : d;
  }
  return out;
}

function edt(grid: Float64Array, w: number, h: number, f: Float64Array, v: Int32Array, z: Float64Array) {
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Int32Array,
  z: Float64Array,
) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}
