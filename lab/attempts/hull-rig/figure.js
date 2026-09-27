// Low-poly faceted mannequin built from convex hulls of hand-shaped point clouds,
// parented into a small FK rig (legs solved with analytic 2-bone IK so feet stay planted).
//
// createFigure(options) -> { object, update(t, dt), dispose() }
//   options.edgeColor   (default 0x1a1a1a)
//   options.edgeOpacity (default 1)
//   options.baseColor   (optional tint, multiplies the facet colors)
//
// Units: meters. ~1.75 m tall, feet on y = 0, facing +Z. Figure's left side is +X.
//
// Neighbouring torso hulls (pelvis | abdomen | chest) and the knee / elbow hulls share
// their boundary ring of points, so in the rest pose they meet in one continuous
// faceted surface (the ring becomes a crease, like a real low-poly mesh). Shoulders,
// hips, neck, wrists and ankles overlap instead.

import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// rest skeleton (world-space rest positions, meters; left side, right is mirrored)
const REST = {
  pelvis: [0, 0.948, 0],
  spine: [0, 1.045, 0], // waist ring centre
  chest: [0, 1.18, 0], // lower-rib ring centre
  neck: [0, 1.47, -0.025],
  head: [0, 1.575, -0.005],
  shoulder: [0.178, 1.405, -0.02],
  hip: [0.09, 0.898, 0.0],
  ankle: [0.172, 0.08, 0.0],
};
const L_UPPER = 0.3;
const L_FORE = 0.25;
const L_THIGH = 0.415;
const L_SHIN = 0.41;
const ARM_ABDUCT = 13 * DEG;
const ARM_FLEX = 2 * DEG; // upper arm slightly back
const ELBOW_FLEX = 12 * DEG;
const FORE_TWIST = -20 * DEG; // mild pronation (mirrored per side)
const TOE_OUT = 14 * DEG;
const KNEE_POLE_OUT = 6 * DEG;
const HEAD_SCALE = 1.05;

// ---------------------------------------------------------------------------
// point-cloud helpers

// ring of points around (cx, y, cz); separate front/back depth; superellipse `sq`
function ring(pts, rng, o) {
  const n = o.n || 8;
  const jit = o.jit ?? 0.28;
  const yj = o.yj ?? 0.006;
  const rj = o.rj ?? 0.035;
  const e = 2 / (o.sq || 2);
  const ph = o.phase ?? rng();
  const rzF = o.rzF ?? o.rz;
  const rzB = o.rzB ?? rzF;
  for (let i = 0; i < n; i++) {
    const a = (TAU * (i + ph + (rng() - 0.5) * 2 * jit)) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = Math.sign(c) * Math.pow(Math.abs(c), e);
    const pz = Math.sign(s) * Math.pow(Math.abs(s), e);
    const rr = 1 + (rng() - 0.5) * 2 * rj;
    pts.push([
      (o.cx || 0) + o.rx * px * rr,
      o.y + (rng() - 0.5) * 2 * yj,
      (o.cz || 0) + (pz > 0 ? rzF : rzB) * pz * rr,
    ]);
  }
  return pts;
}

const copyPts = (p) => p.map((q) => q.slice());

function mirror(p, s) {
  if (s === 1) return p;
  for (const q of p) q[0] = -q[0];
  return p;
}

function offset(p, o) {
  for (const q of p) {
    q[0] -= o[0];
    q[1] -= o[1];
    q[2] -= o[2];
  }
  return p;
}

// express points given in a parent bone frame in the child frame
// (child sits at (0, -len, 0) with local rotation q)
function toChildFrame(p, len, q) {
  const inv = q.clone().invert();
  const v = new THREE.Vector3();
  return p.map((a) => {
    v.set(a[0], a[1] + len, a[2]).applyQuaternion(inv);
    return [v.x, v.y, v.z];
  });
}

// ---------------------------------------------------------------------------
// body part point clouds. Torso/head parts are authored in world rest space;
// limbs in their bone frame (joint at origin, bone along -Y, +Z forward,
// +X lateral for the left side; mirrored for the right).

function torsoRings(rng) {
  return {
    waist: ring([], rng, { y: 1.045, rx: 0.127, rzF: 0.095, rzB: 0.086, n: 7, yj: 0.008 }),
    rib: ring([], rng, { y: 1.18, rx: 0.142, rzF: 0.106, rzB: 0.092, n: 7, yj: 0.01 }),
  };
}

function torsoPelvis(rng, waist) {
  const p = copyPts(waist);
  ring(p, rng, { y: 0.945, rx: 0.157, rzF: 0.088, rzB: 0.102, n: 7, sq: 2.1, yj: 0.012 });
  for (const s of [1, -1]) {
    p.push(
      [s * 0.155, 0.905, -0.012], // hip side
      [s * 0.12, 0.895, -0.1], // buttock
      [s * 0.135, 0.865, -0.086], // gluteal fold (rises laterally)
      [s * 0.075, 0.835, -0.1],
      [s * 0.025, 0.818, -0.088],
      [s * 0.13, 0.918, 0.048], // inguinal V (runs diagonally down to the crotch)
      [s * 0.075, 0.85, 0.064],
      [s * 0.032, 0.81, 0.056],
    );
  }
  p.push([0, 0.795, 0.04], [0, 0.802, -0.045]);
  return p;
}

function torsoAbdomen(rng, waist, rib) {
  const p = copyPts(waist).concat(copyPts(rib));
  p.push([0.024, 1.112, 0.1]); // one belly point breaks up the band
  return p;
}

function torsoChest(rng, rib) {
  const p = copyPts(rib);
  ring(p, rng, { y: 1.265, rx: 0.155, rzF: 0.114, rzB: 0.1, n: 7, sq: 2.3, yj: 0.016 });
  ring(p, rng, { y: 1.355, rx: 0.164, rzF: 0.108, rzB: 0.106, cz: -0.004, n: 8, sq: 2.2, yj: 0.012 });
  // shoulder girdle / trapezius landmarks (both sides)
  for (const s of [1, -1]) {
    p.push(
      [s * 0.064, 1.522, -0.03], // neck base side
      [s * 0.042, 1.528, -0.064], // upper trapezius behind the neck
      [s * 0.12, 1.478, -0.04], // trapezius mid
      [s * 0.174, 1.436, -0.022], // acromion
      [s * 0.155, 1.415, 0.04], // front shoulder
      [s * 0.086, 1.44, 0.064], // clavicle mid
      [s * 0.122, 1.425, -0.092], // scapula top
      [s * 0.098, 1.335, -0.114], // shoulder blade
      [s * 0.086, 1.282, 0.118], // pec
      [s * 0.05, 1.258, 0.118], // lower pec
    );
  }
  p.push([0, 1.515, -0.086], [0, 1.43, 0.066]); // C7, sternal notch
  return p;
}

function neckPart(rng) {
  const p = [];
  ring(p, rng, { y: 1.43, rx: 0.068, rzF: 0.062, rzB: 0.052, cz: -0.024, n: 6, jit: 0.15 });
  ring(p, rng, { y: 1.51, rx: 0.061, rzF: 0.06, rzB: 0.062, cz: -0.02, n: 5, jit: 0.15, yj: 0.012 });
  ring(p, rng, { y: 1.585, rx: 0.055, rzF: 0.056, rzB: 0.056, cz: -0.012, n: 6, jit: 0.15 });
  return p;
}

function headPart(rng) {
  const p = [];
  p.push([0, 1.757, -0.012]);
  ring(p, rng, { y: 1.743, rx: 0.056, rzF: 0.056, rzB: 0.066, cz: -0.012, n: 5, yj: 0.004 });
  ring(p, rng, { y: 1.708, rx: 0.072, rzF: 0.088, rzB: 0.097, cz: -0.008, n: 7, yj: 0.008 });
  ring(p, rng, { y: 1.66, rx: 0.077, rzF: 0.098, rzB: 0.1, cz: -0.005, n: 7, yj: 0.008 });
  ring(p, rng, { y: 1.613, rx: 0.073, rzF: 0.098, rzB: 0.088, cz: 0.0, n: 7, yj: 0.008 });
  ring(p, rng, { y: 1.575, rx: 0.065, rzF: 0.082, rzB: 0.062, cz: 0.004, n: 6, yj: 0.006 });
  ring(p, rng, { y: 1.548, rx: 0.052, rzF: 0.064, rzB: 0.038, cz: 0.012, n: 5, yj: 0.004 });
  p.push([0, 1.524, 0.064], [0.03, 1.53, 0.058], [-0.03, 1.53, 0.058]);
  for (const q of p) {
    q[0] *= HEAD_SCALE;
    q[1] = 1.528 + (q[1] - 1.528) * HEAD_SCALE;
    q[2] *= HEAD_SCALE;
  }
  return p;
}

function elbowRing(rng) {
  return ring([], rng, { y: -L_UPPER, rx: 0.038, rzF: 0.037, rzB: 0.041, n: 5, yj: 0.006, jit: 0.2 });
}

function upperArm(rng, elbow) {
  const p = copyPts(elbow);
  ring(p, rng, { y: 0.028, rx: 0.03, rzF: 0.036, rzB: 0.038, cx: -0.018, n: 4, yj: 0.004 });
  ring(p, rng, { y: 0.0, rx: 0.045, rzF: 0.048, rzB: 0.05, cx: -0.006, n: 5, yj: 0.004 });
  ring(p, rng, { y: -0.035, rx: 0.056, rzF: 0.056, rzB: 0.057, cx: 0.004, n: 6, yj: 0.012 });
  ring(p, rng, { y: -0.16, rx: 0.047, rzF: 0.052, rzB: 0.047, cx: 0.003, cz: 0.002, n: 5, yj: 0.03 });
  p.push([0, -0.29, -0.046]); // olecranon
  return p;
}

function forearm(rng, elbowInFore) {
  const p = copyPts(elbowInFore);
  ring(p, rng, { y: -0.065, rx: 0.043, rzF: 0.043, rzB: 0.04, cx: 0.004, n: 5, yj: 0.014 });
  ring(p, rng, { y: -0.17, rx: 0.031, rzF: 0.033, rzB: 0.03, n: 4, yj: 0.02 });
  ring(p, rng, { y: -0.255, rx: 0.021, rzF: 0.029, rzB: 0.027, n: 4, yj: 0.006 });
  return p;
}

function hand(rng) {
  const p = [];
  ring(p, rng, { y: 0.012, rx: 0.02, rz: 0.028, n: 4, yj: 0.003 });
  ring(p, rng, { y: -0.06, rx: 0.026, rzF: 0.054, rzB: 0.044, cz: 0.004, n: 5, yj: 0.01 });
  p.push([0.018, -0.12, 0.04], [-0.022, -0.125, 0.036], [0.016, -0.118, -0.036], [-0.02, -0.122, -0.034]); // knuckles
  p.push([-0.008, -0.17, 0.026], [-0.01, -0.172, -0.014], [0.002, -0.162, 0.008]); // finger ends
  p.push([-0.018, -0.09, 0.06]); // thumb
  return p;
}

function kneeRing(rng) {
  return ring([], rng, { y: -L_THIGH, rx: 0.05, rzF: 0.05, rzB: 0.048, n: 6, yj: 0.006, jit: 0.2 });
}

function thigh(rng, knee) {
  const p = copyPts(knee);
  ring(p, rng, { y: 0.06, rx: 0.05, rzF: 0.05, rzB: 0.06, cx: -0.004, cz: -0.01, n: 4, yj: 0.004 });
  ring(p, rng, { y: 0.015, rx: 0.065, rzF: 0.058, rzB: 0.078, cx: -0.006, cz: -0.006, n: 6, yj: 0.006 });
  ring(p, rng, { y: -0.095, rx: 0.084, rzF: 0.083, rzB: 0.086, cx: -0.012, cz: 0.0, n: 7, yj: 0.012 });
  ring(p, rng, { y: -0.23, rx: 0.076, rzF: 0.076, rzB: 0.07, cx: -0.006, cz: 0.006, n: 5, yj: 0.03 });
  p.push([0, -0.385, 0.062], [-0.054, -0.39, 0.006]); // kneecap, medial knee
  return p;
}

function shin(rng, kneeInShin) {
  const p = copyPts(kneeInShin);
  ring(p, rng, { y: -0.13, rx: 0.058, rzF: 0.049, rzB: 0.071, cx: -0.004, cz: -0.012, n: 6, yj: 0.03 });
  ring(p, rng, { y: -0.29, rx: 0.042, rzF: 0.038, rzB: 0.046, cz: -0.006, n: 4, yj: 0.02 });
  ring(p, rng, { y: -0.395, rx: 0.036, rzF: 0.035, rzB: 0.04, n: 5, yj: 0.01 });
  p.push([0, -0.1, 0.052]); // tibia crest
  return p;
}

// foot in ankle frame (sole at y = -0.08); +Z toward toes, +X lateral (left)
function foot(rng) {
  const j = () => (rng() - 0.5) * 0.008;
  return [
    [0.027 + j(), -0.08, -0.048], [-0.026 + j(), -0.08, -0.05], [j(), -0.056, -0.066],
    [0.026, -0.02 + j(), -0.048], [-0.025, -0.024 + j(), -0.048],
    [0.033, 0.022, -0.01], [-0.033, 0.022, -0.01], [0, 0.034, 0.024], [0, 0.024, -0.034],
    [0.038 + j(), -0.01, 0.06], [-0.036 + j(), -0.004, 0.064], [j(), 0.01, 0.072],
    [0.046, -0.08, 0.112], [-0.043, -0.08, 0.124], [0.043, -0.054 + j(), 0.11], [-0.039, -0.044 + j(), 0.122],
    [0.02, -0.08, 0.17], [-0.024, -0.08, 0.18], [-0.004, -0.066 + j(), 0.185], [0.002 + j(), -0.05, 0.158],
  ];
}

// ---------------------------------------------------------------------------
// geometry: hull -> non-indexed flat triangles with per-facet color + all-edge lines

const SHADE_LO = 0.76;
const SHADE_HI = 1.06;

function buildPartGeometry(points, rng, base) {
  const vecs = points.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
  const hull = new ConvexHull().setFromPoints(vecs);
  const pos = [];
  const nrm = [];
  const col = [];
  const ids = new Map();
  const seen = new Set();
  const lines = [];
  const c = new THREE.Color();
  const id = (v) => {
    let k = ids.get(v);
    if (k === undefined) {
      k = ids.size;
      ids.set(v, k);
    }
    return k;
  };
  for (const face of hull.faces) {
    const vs = [];
    let e = face.edge;
    do {
      vs.push(e.head());
      e = e.next;
    } while (e !== face.edge);
    // per-facet tone (sRGB), a few lighter highlights, slight warm/cool drift
    let k = SHADE_LO + (SHADE_HI - SHADE_LO) * rng();
    if (rng() < 0.07) k *= 1.14;
    const warm = (rng() - 0.5) * 0.03;
    c.setRGB(
      Math.min(1, base.r * k * (1 + warm)),
      Math.min(1, base.g * k),
      Math.min(1, base.b * k * (1 - warm)),
      THREE.SRGBColorSpace,
    );
    for (let i = 0; i < vs.length; i++) {
      const pt = vs[i].point;
      pos.push(pt.x, pt.y, pt.z);
      nrm.push(face.normal.x, face.normal.y, face.normal.z);
      col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < vs.length; i++) {
      const a = id(vs[i]);
      const b = id(vs[(i + 1) % vs.length]);
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = vs[i].point;
      const pb = vs[(i + 1) % vs.length].point;
      lines.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  edges.computeBoundingSphere();
  return { geo, edges };
}

// ---------------------------------------------------------------------------

export function createFigure(options = {}) {
  const edgeColor = options.edgeColor ?? 0x1a1a1a;
  const edgeOpacity = options.edgeOpacity ?? 1;
  const base = new THREE.Color();
  base.r = 0.735;
  base.g = 0.725;
  base.b = 0.69; // sRGB components; converted per facet
  if (options.baseColor !== undefined) {
    const tint = new THREE.Color(options.baseColor);
    base.r *= tint.r;
    base.g *= tint.g;
    base.b *= tint.b;
  }

  const rng = mulberry32(0x5eed1234);
  const geometries = [];
  const surfaceMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: edgeColor,
    transparent: true,
    opacity: edgeOpacity,
  });
  // Edge lines thin out with camera distance so the figure reads as a solid,
  // faceted body (not a wireframe) when it is small on screen.
  const fade = {
    near: options.edgeFadeNear ?? 5,
    far: options.edgeFadeFar ?? 15,
    farOpacity: options.edgeFarOpacity ?? 0.4,
  };
  edgeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeFade = { value: new THREE.Vector3(fade.near, fade.far, fade.farOpacity) };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec3 uEdgeFade;\nvarying float vEdgeFade;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvEdgeFade = mix(1.0, uEdgeFade.z, smoothstep(uEdgeFade.x, uEdgeFade.y, -mvPosition.z));');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vEdgeFade;\nvoid main() {')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= vEdgeFade;\n\t#include <opaque_fragment>');
  };
  edgeMat.customProgramCacheKey = () => 'hull-rig-edge-fade';

  const root = new THREE.Group();
  root.name = 'hull-rig-figure';

  const joint = (name, parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const addPart = (parentJoint, points, name) => {
    const { geo, edges } = buildPartGeometry(points, rng, base);
    geometries.push(geo, edges);
    const mesh = new THREE.Mesh(geo, surfaceMat);
    mesh.name = name;
    const line = new THREE.LineSegments(edges, edgeMat);
    line.name = name + '-edges';
    mesh.add(line);
    parentJoint.add(mesh);
    return mesh;
  };
  const rel = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  // ---- scratch objects (no per-frame allocation)
  const _hip = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _knee = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _qThigh = new THREE.Quaternion();
  const _qShin = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion();

  // quaternion whose local -Y points along `dir` and local +Z is as close to `fwd` as possible
  function boneQuat(out, dir, fwd) {
    _y.copy(dir).multiplyScalar(-1);
    _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }

  // analytic 2-bone IK: hip joint follows the pelvis, ankle stays on its planted target
  function solveLeg(g, pp, pq) {
    _hip.copy(g.hipLocal).applyQuaternion(pq).add(pp);
    _d.subVectors(g.target, _hip);
    let dist = _d.length();
    _d.divideScalar(dist);
    dist = Math.min(dist, L_THIGH + L_SHIN - 1e-5);
    const cosA = (L_THIGH * L_THIGH + dist * dist - L_SHIN * L_SHIN) / (2 * L_THIGH * dist);
    const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
    _b.copy(g.pole).addScaledVector(_d, -g.pole.dot(_d)).normalize();
    _knee.copy(_hip).addScaledVector(_d, L_THIGH * Math.cos(A)).addScaledVector(_b, L_THIGH * Math.sin(A));
    _d.subVectors(_knee, _hip).normalize();
    boneQuat(_qThigh, _d, g.pole);
    _d.subVectors(g.target, _knee).normalize();
    boneQuat(_qShin, _d, g.pole);
    _qInv.copy(pq).invert();
    g.hip.quaternion.multiplyQuaternions(_qInv, _qThigh);
    _qInv.copy(_qThigh).invert();
    g.knee.quaternion.multiplyQuaternions(_qInv, _qShin);
    _qInv.copy(_qShin).invert();
    g.ankle.quaternion.multiplyQuaternions(_qInv, g.footQ);
  }

  // --- torso chain
  const pelvis = joint('pelvis', root, ...REST.pelvis);
  const spine = joint('spine', pelvis, ...rel(REST.spine, REST.pelvis));
  const chest = joint('chest', spine, ...rel(REST.chest, REST.spine));
  const neck = joint('neck', chest, ...rel(REST.neck, REST.chest));
  const head = joint('head', neck, ...rel(REST.head, REST.neck));

  const tr = torsoRings(rng);
  addPart(pelvis, offset(torsoPelvis(rng, tr.waist), REST.pelvis), 'pelvis');
  addPart(spine, offset(torsoAbdomen(rng, tr.waist, tr.rib), REST.spine), 'abdomen');
  const chestMesh = addPart(chest, offset(torsoChest(rng, tr.rib), REST.chest), 'chest');
  addPart(neck, offset(neckPart(rng), REST.neck), 'neck');
  addPart(head, offset(headPart(rng), REST.head), 'head');

  // --- arms
  const arms = [];
  for (const s of [1, -1]) {
    const sp = [s * REST.shoulder[0], REST.shoulder[1], REST.shoulder[2]];
    const shoulder = joint(s > 0 ? 'shoulderL' : 'shoulderR', chest, ...rel(sp, REST.chest));
    const elbow = joint('elbow', shoulder, 0, -L_UPPER, 0);
    const wrist = joint('wrist', elbow, 0, -L_FORE, 0);
    elbow.rotation.set(-ELBOW_FLEX, s * FORE_TWIST, 0);
    const eRing = mirror(elbowRing(rng), s);
    addPart(shoulder, upperArm(rng, eRing).map((q, i) => (i < eRing.length ? q : [s * q[0], q[1], q[2]])), 'upperArm');
    const foreLocal = mirror(forearm(rng, []), s);
    addPart(elbow, toChildFrame(eRing, L_UPPER, elbow.quaternion).concat(foreLocal), 'forearm');
    addPart(wrist, mirror(hand(rng), s), 'hand');
    arms.push({ s, shoulder, elbow, wrist, rest: shoulder.position.clone() });
  }

  // --- legs (orientation solved by IK every update)
  const legs = [];
  for (const s of [1, -1]) {
    const hip = joint(s > 0 ? 'hipL' : 'hipR', pelvis, ...rel([s * REST.hip[0], REST.hip[1], REST.hip[2]], REST.pelvis));
    const knee = joint('knee', hip, 0, -L_THIGH, 0);
    const ankle = joint('ankle', knee, 0, -L_SHIN, 0);
    const g = {
      s,
      hip,
      knee,
      ankle,
      hipLocal: hip.position.clone(),
      target: new THREE.Vector3(s * REST.ankle[0], REST.ankle[1], REST.ankle[2]),
      pole: new THREE.Vector3(s * Math.sin(KNEE_POLE_OUT), 0, Math.cos(KNEE_POLE_OUT)),
      footQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * TOE_OUT),
    };
    legs.push(g);
    // neutral pose -> shared knee ring expressed in both thigh and shin frames
    solveLeg(g, pelvis.position, pelvis.quaternion);
    const kRing = mirror(kneeRing(rng), s);
    const thighPts = thigh(rng, []);
    addPart(hip, kRing.concat(mirror(thighPts, s)), 'thigh');
    addPart(knee, toChildFrame(kRing, L_THIGH, knee.quaternion).concat(mirror(shin(rng, []), s)), 'shin');
    addPart(ankle, mirror(foot(rng), s), 'foot');
  }

  const neckRest = neck.position.clone();

  // ---- idle signals (pure functions of t)
  const breath = (t) => 0.5 - 0.5 * Math.cos((TAU * t) / 4.6); // 0 exhaled .. 1 inhaled
  const shift = (t) => 0.82 * Math.sin((TAU * t) / 10.4) + 0.18 * Math.sin((TAU * t) / 6.3 + 0.8);
  const pelvisRollAt = (t) => 1.6 * DEG * shift(t);
  const spineRollAt = (t) => -0.8 * DEG * shift(t);
  const chestRollAt = (t) => -0.6 * DEG * shift(t);
  const chestWorldRollAt = (t) => pelvisRollAt(t) + spineRollAt(t) + chestRollAt(t);
  const swayPitchAt = (t) => 0.6 * DEG * Math.sin((TAU * t) / 7.9 + 1.3) + 0.35 * DEG * Math.sin((TAU * t) / 12.1);

  function update(t /* , dt */) {
    const br = breath(t);
    const ws = shift(t);

    // pelvis: lateral weight shift, slight drop, roll toward unweighted side
    pelvis.position.set(
      REST.pelvis[0] + 0.019 * ws,
      REST.pelvis[1] - 0.0065 * ws * ws + 0.001 * br,
      REST.pelvis[2] + 0.003 * Math.sin((TAU * t) / 7.9 + 1.3),
    );
    pelvis.rotation.set(-0.4 * swayPitchAt(t), 1.1 * DEG * ws, pelvisRollAt(t));

    // spine counter-rotation; chest opens slightly on inhale
    spine.rotation.set(0.5 * swayPitchAt(t) - 0.4 * DEG * br, -0.5 * DEG * ws, spineRollAt(t));
    chest.rotation.set(0.4 * swayPitchAt(t - 0.3) - 0.5 * DEG * br, -0.4 * DEG * ws, chestRollAt(t));

    // breathing: chest volume + children ride on the expanding ribcage
    const sx = 1 + 0.012 * br;
    const sy = 1 + 0.009 * br;
    const sz = 1 + 0.02 * br;
    chestMesh.scale.set(sx, sy, sz);
    neck.position.set(neckRest.x * sx, neckRest.y * sy, neckRest.z * sz);

    // head drift (incommensurate periods), keeps roughly level
    const cr = chestWorldRollAt(t);
    const yaw = 3.2 * DEG * (0.55 * Math.sin((TAU * t) / 11.3 + 0.4) + 0.3 * Math.sin((TAU * t) / 6.7 + 1.9) + 0.15 * Math.sin((TAU * t) / 17.9));
    const pitch = 2.2 * DEG * (0.6 * Math.sin((TAU * t) / 9.1 + 2.3) + 0.4 * Math.sin((TAU * t) / 5.3 + 0.2)) + 0.6 * DEG * br;
    neck.rotation.set(0.35 * pitch, 0.35 * yaw, -0.3 * cr);
    head.rotation.set(0.65 * pitch, 0.65 * yaw, -0.45 * cr + 0.6 * DEG * Math.sin((TAU * t) / 8.3 + 2.0));

    // arms: hang, lag behind torso roll (pendulum-ish), tiny forward/back sway
    const lagRoll = chestWorldRollAt(t - 0.7);
    for (const a of arms) {
      const s = a.s;
      a.shoulder.position.set(a.rest.x * sx + s * 0.001 * br, a.rest.y * sy + 0.004 * br, a.rest.z * sz);
      const swing = 0.9 * DEG * Math.sin((TAU * t) / 6.1 + (s > 0 ? 0.0 : 1.7)) + 0.6 * swayPitchAt(t - 0.6);
      a.shoulder.rotation.set(ARM_FLEX + swing, s * 1.5 * DEG, s * ARM_ABDUCT - 0.85 * lagRoll + 0.4 * DEG * br * s);
      a.elbow.rotation.set(-ELBOW_FLEX - 0.8 * DEG * Math.sin((TAU * t) / 6.1 + (s > 0 ? -0.6 : 1.1)), s * FORE_TWIST, 0);
      a.wrist.rotation.set(-3 * DEG, 0, s * -4 * DEG);
    }

    // legs: 2-bone IK from hip (following pelvis) to planted ankle
    for (const g of legs) solveLeg(g, pelvis.position, pelvis.quaternion);
  }

  update(0);

  function dispose() {
    for (const g of geometries) g.dispose();
    surfaceMat.dispose();
    edgeMat.dispose();
  }

  return { object: root, update, dispose };
}
