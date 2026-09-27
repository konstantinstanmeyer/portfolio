// node verify.mjs  — numeric checks of the idle: planted feet, minY, motion amplitude, build time
import * as THREE from 'three';
const t0 = performance.now();
const { createFigure } = await import('./figure.js');
const tImport = performance.now();
const fig = createFigure();
const tBuild = performance.now();
const mesh = fig.object.children[0];
const pos = mesh.geometry.attributes.position;
const n = pos.count;
const v = new THREE.Vector3();
function snapshot(t) {
  fig.update(t, 1 / 60);
  fig.object.updateMatrixWorld(true);
  mesh.skeleton.update();
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  return out;
}
const rest = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { rest[i * 3] = pos.getX(i); rest[i * 3 + 1] = pos.getY(i); rest[i * 3 + 2] = pos.getZ(i); }
const base = snapshot(0);
let footMax = 0, minY = Infinity, maxY = -Infinity, bodyMax = 0, headMax = 0, handMax = 0, restDev = 0;
for (let i = 0; i < n; i++) restDev = Math.max(restDev, Math.hypot(base[i*3]-rest[i*3], base[i*3+1]-rest[i*3+1], base[i*3+2]-rest[i*3+2]));
const tp = performance.now();
let frames = 0;
for (let t = 0; t <= 60; t += 0.25) {
  const s = snapshot(t); frames++;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(s[i*3]-base[i*3], s[i*3+1]-base[i*3+1], s[i*3+2]-base[i*3+2]);
    const y = rest[i*3+1];
    if (y < 0.1) footMax = Math.max(footMax, d);
    if (y > 1.52) headMax = Math.max(headMax, d);
    if (Math.abs(rest[i*3]) > 0.25 && y < 0.95) handMax = Math.max(handMax, d);
    bodyMax = Math.max(bodyMax, d);
    minY = Math.min(minY, s[i*3+1]); maxY = Math.max(maxY, s[i*3+1]);
  }
}
const tPose = performance.now();
// cost of a pose update alone
const tu0 = performance.now(); for (let k = 0; k < 10000; k++) fig.update(k * 0.013, 1/60); const tu1 = performance.now();
console.log(JSON.stringify({ import_ms: +(tImport - t0).toFixed(1), build_ms: +(tBuild - tImport).toFixed(2), update_us: +((tu1 - tu0) / 10000 * 1000).toFixed(2),
  tris: n / 3, restDeviation_mm: +(restDev*1000).toFixed(2), footMax_mm: +(footMax * 1000).toFixed(2), handMax_mm: +(handMax*1000).toFixed(1), headMax_mm: +(headMax*1000).toFixed(1), bodyMax_mm: +(bodyMax*1000).toFixed(1), minY: +minY.toFixed(4), maxY: +maxY.toFixed(4) }, null, 1));
fig.dispose();
