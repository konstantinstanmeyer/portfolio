// topology / orientation checks for data.js
import { POS, IDX, POS_SCALE } from './data.js';
const nv = POS.length / 3, nf = IDX.length / 3;
const P = (i) => [POS[i*3]/POS_SCALE, POS[i*3+1]/POS_SCALE, POS[i*3+2]/POS_SCALE];
const edges = new Map();
for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
  const a = IDX[f*3+k], b = IDX[f*3+(k+1)%3];
  const key = a < b ? a+'_'+b : b+'_'+a;
  const e = edges.get(key) || { n: 0, dir: 0 };
  e.n++; e.dir += a < b ? 1 : -1; edges.set(key, e);
}
let bad = 0, nonman = 0, inconsistent = 0;
for (const e of edges.values()) { if (e.n !== 2) nonman++; else if (e.dir !== 0) inconsistent++; }
// signed volume + small / skinny faces
let vol = 0, minQ = 1, tiny = 0;
const q = [];
for (let f = 0; f < nf; f++) {
  const a = P(IDX[f*3]), b = P(IDX[f*3+1]), c = P(IDX[f*3+2]);
  vol += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const A = Math.hypot(...n) / 2;
  const l = [u, v, [c[0]-b[0], c[1]-b[1], c[2]-b[2]]].reduce((s, e) => s + e[0]*e[0]+e[1]*e[1]+e[2]*e[2], 0);
  const qq = 4 * Math.sqrt(3) * A / l; q.push(qq); minQ = Math.min(minQ, qq);
  if (A < 1e-6) tiny++;
}
q.sort((x, y) => x - y);
console.log({ nv, nf, edges: edges.size, euler: nv - edges.size + nf, nonManifoldEdges: nonman, inconsistentEdges: inconsistent, volume_m3: +vol.toFixed(4), minQ: +minQ.toFixed(3), q10: +q[Math.floor(nf*0.1)].toFixed(3), qMedian: +q[Math.floor(nf/2)].toFixed(3), tinyFaces: tiny });
