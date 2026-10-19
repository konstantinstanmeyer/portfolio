// Drawing more dots than the simulation moves. The costly part of a dot
// field is its physics (per dot, on the CPU); drawing is cheap. So a fine
// field can be grouped into tight clusters of a few neighbouring dots: the
// simulation moves one carrier per cluster (at the cluster's centre), and
// every dot is drawn at its carrier plus its own fixed offset. At rest each
// dot sits exactly where it was placed; in motion a cluster (about a dot
// spacing or two across) moves as one, which is too small to see.

import type { Dots } from "./stage";

/** How a stage draws clustered dots: carrier c draws dots start[c] … start[c + 1] − 1. */
export interface Clusters {
  /** Dots drawn. */
  count: number;
  start: Uint32Array;
  /** Each drawn dot's offset from its carrier, [dx, dy]. */
  offset: Float32Array;
  /** Each drawn dot's [size, opacity]. */
  attrs: Float32Array;
}

/**
 * Groups `dots` into clusters of up to `size` neighbours. Returns the
 * carriers (one per cluster, at its centre) and how to draw the dots from them.
 */
export function clusterDots(dots: Dots, size: number): { carriers: Dots; clusters: Clusters } {
  const n = dots.count;
  const { home, attrs } = dots;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = home[i * 2];
    const y = home[i * 2 + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  // Tiles hold about `size` dots where the field is densest (where the
  // clusters matter most); sparser tiles just make smaller clusters.
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const tile = Math.max(0.5, Math.sqrt((size * area) / Math.max(1, n)) * 0.75);
  const cols = Math.max(1, Math.ceil((x1 - x0) / tile) + 1);
  const rows = Math.max(1, Math.ceil((y1 - y0) / tile) + 1);
  const cellOf = new Uint32Array(n);
  const counts = new Uint32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) {
    const c = Math.floor((home[i * 2] - x0) / tile) + Math.floor((home[i * 2 + 1] - y0) / tile) * cols;
    cellOf[i] = c;
    counts[c + 1]++;
  }
  for (let c = 0; c < cols * rows; c++) counts[c + 1] += counts[c];
  // Dots in tile order (a counting sort keeps each tile's dots in their own order).
  const order = new Uint32Array(n);
  const fill = counts.slice();
  for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;

  // Each tile's dots are split in halves across their longer side until every
  // group has at most `size`: compact clusters, not strips along a row.
  const groups: number[] = [];
  const split = (a: number, b: number) => {
    if (b - a <= size) {
      groups.push(a, b);
      return;
    }
    let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
    for (let j = a; j < b; j++) {
      const x = home[order[j] * 2];
      const y = home[order[j] * 2 + 1];
      if (x < gx0) gx0 = x;
      if (x > gx1) gx1 = x;
      if (y < gy0) gy0 = y;
      if (y > gy1) gy1 = y;
    }
    const axis = gx1 - gx0 >= gy1 - gy0 ? 0 : 1;
    const part = Array.from(order.subarray(a, b)).sort((i, k) => home[i * 2 + axis] - home[k * 2 + axis]);
    order.set(part, a);
    // Halves in multiples of `size` where possible, so few groups come out short.
    const mid = a + Math.max(1, Math.min(b - a - 1, Math.round((b - a) / 2 / size) * size || Math.ceil((b - a) / 2)));
    split(a, mid);
    split(mid, b);
  };
  for (let c = 0; c < cols * rows; c++) if (counts[c + 1] > counts[c]) split(counts[c], counts[c + 1]);

  const clusterCount = groups.length / 2;
  const start = new Uint32Array(clusterCount + 1);
  const carrierHome = new Float32Array(clusterCount * 2);
  const offset = new Float32Array(n * 2);
  const drawAttrs = new Float32Array(n * 2);
  for (let k = 0; k < clusterCount; k++) {
    const a = groups[k * 2];
    const b = groups[k * 2 + 1];
    let cx = 0;
    let cy = 0;
    for (let j = a; j < b; j++) {
      cx += home[order[j] * 2];
      cy += home[order[j] * 2 + 1];
    }
    cx /= b - a;
    cy /= b - a;
    carrierHome[k * 2] = cx;
    carrierHome[k * 2 + 1] = cy;
    start[k] = a;
    for (let j = a; j < b; j++) {
      const i = order[j];
      offset[j * 2] = home[i * 2] - cx;
      offset[j * 2 + 1] = home[i * 2 + 1] - cy;
      drawAttrs[j * 2] = attrs[i * 2];
      drawAttrs[j * 2 + 1] = attrs[i * 2 + 1];
    }
  }
  start[clusterCount] = n;
  return {
    // The carriers' own looks are never drawn; any will do.
    carriers: { count: clusterCount, home: carrierHome, attrs: new Float32Array(clusterCount * 2) },
    clusters: { count: n, start, offset, attrs: drawAttrs },
  };
}

/** Each drawn dot's position: its carrier's (from `carriers`, [x, y] each) plus its offset, into `out`. */
export function expandClusters(clusters: Clusters, carriers: Float32Array, out: Float32Array): Float32Array {
  const { start, offset } = clusters;
  const m = start.length - 1;
  for (let c = 0; c < m; c++) {
    const x = carriers[c * 2];
    const y = carriers[c * 2 + 1];
    for (let j = start[c]; j < start[c + 1]; j++) {
      out[j * 2] = x + offset[j * 2];
      out[j * 2 + 1] = y + offset[j * 2 + 1];
    }
  }
  return out;
}
