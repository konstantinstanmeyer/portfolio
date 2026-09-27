// Numeric checks: foot drift, minY, build time, joint ranges.
import * as THREE from 'three';
import { createFigure } from './figure.js';
const t0 = performance.now();
const fig = createFigure();
const t1 = performance.now();
console.log('build ms', (t1 - t0).toFixed(1));
let tris = 0;
fig.object.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
console.log('tris', tris);
const feet = [];
fig.object.traverse((o) => { if (o.name === 'foot') feet.push(o); });
const heads = []; fig.object.traverse((o) => { if (o.name === 'head') heads.push(o); });
const box = new THREE.Box3();
const ref = [];
let maxDrift = 0, minY = 1e9, maxMinY = -1e9;
const hp = new THREE.Vector3(); let hx0 = 1e9, hx1 = -1e9;
for (let t = 0; t <= 60; t += 0.25) {
  fig.update(t, 1 / 60);
  fig.object.updateMatrixWorld(true);
  box.setFromObject(fig.object);
  minY = Math.min(minY, box.min.y); maxMinY = Math.max(maxMinY, box.min.y);
  feet.forEach((f, i) => {
    const p = f.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k += 7) {
      v.fromBufferAttribute(p, k).applyMatrix4(f.matrixWorld);
      const key = i * 1000 + k;
      if (!ref[key]) ref[key] = v.clone();
      maxDrift = Math.max(maxDrift, v.distanceTo(ref[key]));
    }
  });
  heads[0].getWorldPosition(hp); hx0 = Math.min(hx0, hp.x); hx1 = Math.max(hx1, hp.x);
}
console.log('foot max drift (m)', maxDrift.toExponential(2));
console.log('minY range', minY.toFixed(4), maxMinY.toFixed(4));
console.log('head x range', hx0.toFixed(4), hx1.toFixed(4));
const t2 = performance.now();
for (let i = 0; i < 1000; i++) fig.update(i * 0.016, 0.016);
console.log('update us', ((performance.now() - t2)).toFixed(1) + 'us avg');
fig.dispose();
{
  const f = createFigure();
  const hips = []; f.object.traverse((o) => { if (o.name === 'hipL' || o.name === 'hipR') hips.push(o); });
  const anks = []; f.object.traverse((o) => { if (o.name === 'ankle') anks.push(o); });
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let mx = 0, mn = 9;
  for (let t = 0; t <= 60; t += 0.1) {
    f.update(t); f.object.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      hips[i].getWorldPosition(a);
      const tx = (hips[i].name === 'hipL' ? 1 : -1) * 0.172;
      b.set(tx, 0.08, 0);
      const d = a.distanceTo(b); mx = Math.max(mx, d); mn = Math.min(mn, d);
    }
  }
  console.log('hip-ankle dist range', mn.toFixed(4), mx.toFixed(4));
}
