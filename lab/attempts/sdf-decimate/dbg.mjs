// debug: world joint deviation from the bind pose at a few times (mm)
import * as THREE from 'three';
import { createFigure } from './figure.js';
import { BONES } from './data.js';
const fig = createFigure();
const mesh = fig.object.children[0];
for (const t of (process.argv[2] || '0,2.6,5.2').split(',').map(Number)) {
  fig.update(t); fig.object.updateMatrixWorld(true);
  const rows = [];
  mesh.skeleton.bones.forEach((b, i) => {
    const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const r = BONES[i].pos;
    rows.push(`${b.name}:${((p.x - r[0]) * 1000).toFixed(0)},${((p.y - r[1]) * 1000).toFixed(0)},${((p.z - r[2]) * 1000).toFixed(0)}`);
  });
  console.log('t', t, rows.join(' '));
}
