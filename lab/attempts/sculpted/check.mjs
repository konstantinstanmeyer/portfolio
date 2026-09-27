// Dev check (node): manifold/closed-mesh test, orientation sanity, triangle count, build time.
import { createFigure } from './figure.js';
const t0 = performance.now();
const fig = createFigure();
const t1 = performance.now();
let mesh; fig.object.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
const pos = mesh.geometry.attributes.position.array;
const nT = pos.length / 9;
const key = (i) => `${pos[i * 3].toFixed(6)},${pos[i * 3 + 1].toFixed(6)},${pos[i * 3 + 2].toFixed(6)}`;
const ids = new Map(); const vid = (i) => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
const edges = new Map();
let degenerate = 0;
for (let t = 0; t < nT; t++) {
  const v = [vid(t * 3), vid(t * 3 + 1), vid(t * 3 + 2)];
  if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) degenerate++;
  for (let k = 0; k < 3; k++) {
    const a = v[k], b = v[(k + 1) % 3];
    const e = a < b ? `${a}_${b}` : `${b}_${a}`;
    const dir = a < b ? 1 : -1;
    const cur = edges.get(e) || { n: 0, s: 0 };
    cur.n++; cur.s += dir; edges.set(e, cur);
  }
}
let bad = 0, flipped = 0;
for (const [e, c] of edges) { if (c.n !== 2) bad++; else if (c.s !== 0) flipped++; }
// signed volume (positive = outward winding)
let vol = 0;
for (let t = 0; t < nT; t++) {
  const a = [pos[t*9], pos[t*9+1], pos[t*9+2]], b = [pos[t*9+3], pos[t*9+4], pos[t*9+5]], c = [pos[t*9+6], pos[t*9+7], pos[t*9+8]];
  vol += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
}
console.log(`tris=${nT} verts=${ids.size} nonManifoldEdges=${bad} inconsistentWinding=${flipped} degenerate=${degenerate} volume=${vol.toFixed(4)}m3 build=${(t1 - t0).toFixed(1)}ms`);
const t2 = performance.now(); for (let i = 0; i < 1000; i++) fig.update(i * 0.037, 1/60); console.log(`update x1000: ${(performance.now()-t2).toFixed(1)}ms`);

// ---- motion audit: skinned vertex positions over time
import * as THREE from 'three';
const g = mesh.geometry, n = g.attributes.position.count;
const rest = []; for (let i = 0; i < n; i++) rest.push(new THREE.Vector3().fromBufferAttribute(g.attributes.position, i));
const sample = (t) => { fig.update(t, 1/60); mesh.updateMatrixWorld(true); mesh.skeleton.update(); const out = []; const v = new THREE.Vector3(); for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); out.push(v.clone()); } return out; };
const base = sample(0);
let footMax = 0, ankleMax = 0, minY = 1, headMax = 0, handMax = 0, pelvisMax = 0, bodyMax = 0;
for (let t = 0.25; t <= 30; t += 0.25) {
  const cur = sample(t);
  for (let i = 0; i < n; i++) {
    const d = cur[i].distanceTo(base[i]);
    const r = rest[i];
    minY = Math.min(minY, cur[i].y);
    if (r.y < 0.06) footMax = Math.max(footMax, d);
    else if (r.y < 0.12) ankleMax = Math.max(ankleMax, d);
    if (r.y > 1.6) headMax = Math.max(headMax, d);
    if (r.y < 0.9 && Math.abs(r.x) > 0.2) handMax = Math.max(handMax, d);
    if (r.y > 0.85 && r.y < 1.0 && Math.abs(r.x) < 0.15) pelvisMax = Math.max(pelvisMax, d);
    bodyMax = Math.max(bodyMax, d);
  }
}
console.log(`foot(y<6cm) max drift=${(footMax*1000).toFixed(2)}mm ankle(6-12cm)=${(ankleMax*1000).toFixed(2)}mm minY=${minY.toFixed(4)} head=${(headMax*1000).toFixed(1)}mm hands=${(handMax*1000).toFixed(1)}mm pelvis=${(pelvisMax*1000).toFixed(1)}mm any=${(bodyMax*1000).toFixed(1)}mm`);
