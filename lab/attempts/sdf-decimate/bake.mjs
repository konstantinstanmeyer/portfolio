#!/usr/bin/env node
// Offline bake for the "sdf-decimate" figure.
//
//   node bake.mjs [targetTris]
//
// 1. sculpt the body as a signed distance field (smooth union of round cones /
//    ellipsoids, grouped per body part so hands never fuse with thighs)
// 2. polygonize with Surface Nets on a regular grid
// 3. decimate with quadric-error edge collapse (Garland-Heckbert) to ~N tris,
//    which gives the irregular "decimated scan" facet layout
// 4. compute per-vertex bone weights from the part the vertex belongs to and
//    its position along that part's bone chain
// 5. write data.js (quantized positions, indices, skin indices/weights, bones)

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET_TRIS = +(process.argv[2] || 600);
const VOXEL = +(process.env.VOXEL || 0.0055);

// ---------------------------------------------------------------- vec3 utils
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p) => [-p[0], p[1], p[2]];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const deg = Math.PI / 180;

// ------------------------------------------------------------ rest skeleton
// Meters, y up, figure faces +Z, figure's left side is +X.
// Height 1.75, head ~0.233 (7.5 heads).
const JL = {}; // left-side / central joints
JL.pelvis = [0, 0.975, 0.0];
JL.spine1 = [0, 1.045, -0.012];
JL.spine2 = [0, 1.2, -0.02];
JL.breath = [0, 1.29, 0.0];
JL.neck = [0, 1.45, -0.03];
JL.head = [0, 1.555, -0.012];
JL.headTop = [0, 1.75, 0.0];
JL.clav = [0.028, 1.438, 0.0];
JL.shoulder = [0.186, 1.385, -0.018];
{
  const upperLen = 0.285, foreLen = 0.255, handLen = 0.175;
  const ua = norm([Math.sin(13.5 * deg), -Math.cos(13.5 * deg), -0.05]);
  JL.elbow = add(JL.shoulder, mul(ua, upperLen));
  const fa = norm([Math.sin(17 * deg), -1, 0.2]);
  JL.wrist = add(JL.elbow, mul(fa, foreLen));
  const ha = norm([0.03, -1, 0.06]);
  JL.handTip = add(JL.wrist, mul(ha, handLen));
}
JL.hip = [0.08, 0.905, 0.012];
JL.knee = [0.094, 0.49, 0.012];
JL.ankle = [0.102, 0.078, -0.022];
const TOE_OUT = 9 * deg;
JL.toe = add(JL.ankle, [Math.sin(TOE_OUT) * 0.17, -0.05, Math.cos(TOE_OUT) * 0.17]);

// bones: name, parent, joint (head position), tail (for chain weighting)
const R = (p) => mirror(p);
const BONES = [
  { name: 'root', parent: -1, pos: [0, 0, 0] },
  { name: 'pelvis', parent: 0, pos: JL.pelvis },
  { name: 'spine1', parent: 1, pos: JL.spine1 },
  { name: 'spine2', parent: 2, pos: JL.spine2 },
  { name: 'breath', parent: 3, pos: JL.breath },
  { name: 'neck', parent: 3, pos: JL.neck },
  { name: 'head', parent: 5, pos: JL.head },
  { name: 'clavicleL', parent: 3, pos: JL.clav },
  { name: 'upperArmL', parent: 7, pos: JL.shoulder },
  { name: 'forearmL', parent: 8, pos: JL.elbow },
  { name: 'handL', parent: 9, pos: JL.wrist },
  { name: 'clavicleR', parent: 3, pos: R(JL.clav) },
  { name: 'upperArmR', parent: 11, pos: R(JL.shoulder) },
  { name: 'forearmR', parent: 12, pos: R(JL.elbow) },
  { name: 'handR', parent: 13, pos: R(JL.wrist) },
  { name: 'thighL', parent: 1, pos: JL.hip },
  { name: 'shinL', parent: 15, pos: JL.knee },
  { name: 'footL', parent: 16, pos: JL.ankle },
  { name: 'thighR', parent: 1, pos: R(JL.hip) },
  { name: 'shinR', parent: 18, pos: R(JL.knee) },
  { name: 'footR', parent: 19, pos: R(JL.ankle) },
];
const B = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// ------------------------------------------------------------ SDF primitives
// Every primitive: { d(p) -> signed distance, group, k (blend radius) }
function frame(u, hint) {
  const e1 = norm(u);
  const e2 = norm(sub(hint, mul(e1, dot(hint, e1))));
  const e3 = cross(e1, e2);
  return [e1, e2, e3];
}
// IQ exact round cone, local: a=(0,0,0) b=(0,h,0)?  -> generic a,b version
function sdRoundCone(p, a, b, r1, r2) {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pa = sub(p, a);
  const y = dot(pa, ba);
  const z = y - l2;
  const xv = sub(mul(pa, l2), mul(ba, y));
  const x2 = dot(xv, xv);
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoidLocal(q, r) {
  const k0 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  const k1 = Math.hypot(q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2]));
  if (k1 === 0) return -Math.min(r[0], r[1], r[2]);
  return (k0 * (k0 - 1)) / k1;
}
function cone(a, b, r1, r2) {
  return (p) => sdRoundCone(p, a, b, r1, r2);
}
// round cone squashed across its axis: s2 along `hint`, s3 along the third axis
function flatCone(a, b, r1, r2, hint, s2, s3) {
  const [e1, e2, e3] = frame(sub(b, a), hint);
  const L = len(sub(b, a));
  const A = [0, 0, 0], Bp = [L, 0, 0];
  const m = Math.min(1, s2, s3);
  return (p) => {
    const d = sub(p, a);
    const q = [dot(d, e1), dot(d, e2) / s2, dot(d, e3) / s3];
    return sdRoundCone(q, A, Bp, r1, r2) * m;
  };
}
function ell(c, r) {
  return (p) => sdEllipsoidLocal(sub(p, c), r);
}
// oriented ellipsoid: radii [side, up, third]; `up` is the long/second axis,
// `side` is orthogonalized against it
function ellO(c, r, up, side) {
  const [eu, es] = frame(up, side);
  const et = cross(es, eu);
  return (p) => {
    const d = sub(p, c);
    return sdEllipsoidLocal([dot(d, es), dot(d, eu), dot(d, et)], r);
  };
}
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ------------------------------------------------------------- the sculpt
// groups: center (torso/neck/head), armL, armR, legL, legR
const PRIMS = [];
function P(group, bone, k, d) { PRIMS.push({ group, bone, k, d }); }
function both(fn) { fn(1); fn(-1); }
const X = (s, p) => [p[0] * s, p[1], p[2]];

// --- head & neck
P('center', 'head', 0, ellO([0, 1.672, -0.006], [0.072, 0.088, 0.092], [0, 1, -0.12], [1, 0, 0])); // cranium (egg)
P('center', 'head', 0.05, ellO([0, 1.615, 0.02], [0.06, 0.068, 0.066], [0, 1, 0.08], [1, 0, 0])); // cheeks / face
P('center', 'head', 0.035, ellO([0, 1.569, 0.04], [0.033, 0.028, 0.033], [0, 1, -0.1], [1, 0, 0])); // chin
P('center', 'head', 0.04, cone([0, 1.604, -0.01], [0, 1.609, 0.035], 0.05, 0.043)); // jaw mass
P('center', 'neck', 0.03, cone([0, 1.42, -0.03], [0, 1.6, -0.016], 0.06, 0.05)); // neck
// --- torso
P('center', 'spine2', 0.07, ellO([0, 1.28, -0.01], [0.16, 0.17, 0.108], [0, 1, 0], [1, 0, 0])); // rib cage
both((s) => P('center', 'spine2', 0.05, ellO([s * 0.07, 1.318, 0.05], [0.08, 0.06, 0.05], [0, 1, 0], [1, 0, 0]))); // pecs
both((s) => P('center', 'spine2', 0.06, ellO([s * 0.1, 1.29, -0.05], [0.082, 0.14, 0.058], [s * 0.3, 1, 0], [1, 0, 0]))); // lats / scapula
P('center', 'spine2', 0.06, cone([-0.125, 1.352, -0.02], [0.125, 1.352, -0.02], 0.058, 0.058)); // upper chest / shoulder girdle
P('center', 'spine1', 0.08, ellO([0, 1.1, -0.002], [0.126, 0.13, 0.094], [0, 1, 0], [1, 0, 0])); // abdomen / waist
P('center', 'spine1', 0.05, ellO([0, 1.1, 0.042], [0.082, 0.11, 0.055], [0, 1, 0], [1, 0, 0])); // abs front
P('center', 'pelvis', 0.07, ellO([0, 0.958, -0.008], [0.128, 0.105, 0.1], [0, 1, 0], [1, 0, 0])); // pelvis
both((s) => P('center', 'pelvis', 0.05, ellO([s * 0.058, 0.9, -0.056], [0.068, 0.09, 0.068], [0, 1, 0], [1, 0, 0]))); // glutes

// --- arms
both((s) => {
  const g = s > 0 ? 'armL' : 'armR';
  const S = s > 0 ? 'L' : 'R';
  const sh = X(s, JL.shoulder), el = X(s, JL.elbow), wr = X(s, JL.wrist), tip = X(s, JL.handTip);
  // trapezius slope neck -> acromion
  P(g, 'clavicle' + S, 0, cone([s * 0.035, 1.45, -0.035], [s * 0.172, 1.388, -0.025], 0.036, 0.03));
  // deltoid
  P(g, 'upperArm' + S, 0.035, ellO(add(sh, [s * 0.01, -0.045, 0.002]), [0.056, 0.082, 0.06], sub(el, sh), [s, 0, 0]));
  // upper arm (biceps/triceps)
  const mid = lerp3(sh, el, 0.45);
  P(g, 'upperArm' + S, 0.03, cone(sh, mid, 0.052, 0.047));
  P(g, 'upperArm' + S, 0.03, cone(mid, el, 0.047, 0.036));
  // forearm: muscular near elbow, flat towards wrist
  const fm = lerp3(el, wr, 0.3);
  P(g, 'forearm' + S, 0.03, flatCone(el, fm, 0.037, 0.04, [0, 0, 1], 1.0, 0.85));
  P(g, 'forearm' + S, 0.03, flatCone(fm, wr, 0.04, 0.027, [0, 0, 1], 1.0, 0.7));
  // hand: flattened mitten, palm facing the thigh
  const hdir = norm(sub(tip, wr));
  const knuck = add(wr, mul(hdir, 0.08));
  const fingerTip = add(wr, add(mul(hdir, 0.132), [-s * 0.01, 0, -0.002]));
  const palm = [1, 0, s * 0.45]; // palm faces the thigh, turned slightly backwards
  P(g, 'hand' + S, 0.02, flatCone(add(wr, mul(hdir, 0.008)), knuck, 0.031, 0.038, palm, 0.52, 1.0));
  P(g, 'hand' + S, 0.02, flatCone(knuck, fingerTip, 0.037, 0.03, palm, 0.56, 1.0));
});

// --- legs
both((s) => {
  const g = s > 0 ? 'legL' : 'legR';
  const S = s > 0 ? 'L' : 'R';
  const hip = X(s, JL.hip), knee = X(s, JL.knee), ankle = X(s, JL.ankle);
  // upper thigh mass (blends into pelvis/glute)
  P(g, 'thigh' + S, 0, cone(add(hip, [s * 0.0, 0.0, -0.005]), lerp3(hip, knee, 0.55), 0.074, 0.062));
  P(g, 'thigh' + S, 0.04, cone(lerp3(hip, knee, 0.5), knee, 0.065, 0.048));
  // quads bulge (front / outer)
  P(g, 'thigh' + S, 0.05, ellO(add(lerp3(hip, knee, 0.5), [s * 0.008, 0, 0.02]), [0.05, 0.17, 0.047], sub(knee, hip), [s, 0, 0]));
  // knee
  P(g, 'shin' + S, 0.03, ell(add(knee, [0, 0.0, 0.008]), [0.043, 0.05, 0.043]));
  // calf
  P(g, 'shin' + S, 0.05, ellO(add(lerp3(knee, ankle, 0.3), [s * 0.002, 0, -0.02]), [0.047, 0.12, 0.048], sub(knee, ankle), [s, 0, 0]));
  // shin bone line
  P(g, 'shin' + S, 0.03, cone(knee, ankle, 0.045, 0.03));
  // ankle
  P(g, 'foot' + S, 0.025, ell(ankle, [0.034, 0.038, 0.036]));
  // foot: compact wedge heel -> ball -> toes, cut flat at y=0
  const fwd = [s * Math.sin(TOE_OUT), 0, Math.cos(TOE_OUT)];
  const at = (f, y, lat) => [ankle[0] + fwd[0] * f + s * lat, y, ankle[2] + fwd[2] * f];
  const heel = at(-0.018, 0.036, 0);
  const ball = at(0.098, 0.03, 0.006);
  const toe = at(0.138, 0.024, 0.004);
  P(g, 'foot' + S, 0.03, flatCone(heel, ball, 0.042, 0.046, [0, 1, 0], 0.85, 1.0));
  P(g, 'foot' + S, 0.02, flatCone(ball, toe, 0.044, 0.028, [0, 1, 0], 0.72, 1.0));
  P(g, 'foot' + S, 0.04, cone(add(ankle, [0, 0.0, 0.005]), at(0.07, 0.056, 0.002), 0.033, 0.03)); // instep
});

const GROUPS = ['center', 'armL', 'armR', 'legL', 'legR'];
const K_ARM = 0.035, K_LEG = 0.06;
const groupPrims = Object.fromEntries(GROUPS.map((g) => [g, PRIMS.filter((p) => p.group === g)]));

function groupDist(g, p) {
  const list = groupPrims[g];
  let d = Infinity;
  for (const pr of list) d = smin(d, pr.d(p), pr.k);
  return d;
}
function sdf(p) {
  const c = groupDist('center', p);
  let a = smin(c, groupDist('armL', p), K_ARM);
  a = smin(a, groupDist('armR', p), K_ARM);
  let l = smin(c, groupDist('legL', p), K_LEG);
  l = smin(l, groupDist('legR', p), K_LEG);
  const d = Math.min(a, l);
  return Math.max(d, -p[1]); // flat soles at y = 0
}

// ------------------------------------------------------------ surface nets
function surfaceNets(jitter = 0) {
  // grid nodes sit half a voxel off y = 0 so the flat soles land exactly on the plane
  const lo = [-0.42 + jitter * VOXEL, -VOXEL * 0.5 - VOXEL * 2, -0.2 + jitter * 0.7 * VOXEL];
  const hi = [0.42, 1.8, 0.28];
  const nx = Math.ceil((hi[0] - lo[0]) / VOXEL) + 1;
  const ny = Math.ceil((hi[1] - lo[1]) / VOXEL) + 1;
  const nz = Math.ceil((hi[2] - lo[2]) / VOXEL) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const t0 = Date.now();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    F[idx(i, j, k)] = sdf([lo[0] + i * VOXEL, lo[1] + j * VOXEL, lo[2] + k * VOXEL]);
  }
  console.log(`sdf grid ${nx}x${ny}x${nz} in ${Date.now() - t0}ms`);
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const verts = [];
  const cornerOff = [];
  for (let c = 0; c < 8; c++) cornerOff.push([c & 1, (c >> 1) & 1, (c >> 2) & 1]);
  const edges = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    const d = (a ^ b);
    if (d === 1 || d === 2 || d === 4) edges.push([a, b]);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    const vals = new Array(8);
    for (let c = 0; c < 8; c++) {
      const o = cornerOff[c];
      const v = F[idx(i + o[0], j + o[1], k + o[2])];
      vals[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = vals[a], vb = vals[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const oa = cornerOff[a], ob = cornerOff[b];
      sx += oa[0] + (ob[0] - oa[0]) * t;
      sy += oa[1] + (ob[1] - oa[1]) * t;
      sz += oa[2] + (ob[2] - oa[2]) * t;
      n++;
    }
    cellV[cidx(i, j, k)] = verts.length;
    verts.push([lo[0] + (i + sx / n) * VOXEL, lo[1] + (j + sy / n) * VOXEL, lo[2] + (k + sz / n) * VOXEL]);
  }
  const tris = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along shorter diagonal
    const pa = verts[a], pb = verts[b], pc = verts[c], pd = verts[d];
    if (len(sub(pa, pc)) < len(sub(pb, pd))) { tris.push([a, b, c], [a, c, d]); } else { tris.push([a, b, d], [b, c, d]); }
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = F[idx(i, j, k)] < 0;
    // x edge (i,j,k)-(i+1,j,k): cells (i, j-1..j, k-1..k)
    if (i < nx - 1 && (F[idx(i + 1, j, k)] < 0) !== v0) {
      quad(cellV[cidx(i, j - 1, k - 1)], cellV[cidx(i, j, k - 1)], cellV[cidx(i, j, k)], cellV[cidx(i, j - 1, k)], !v0);
    }
    if (j < ny - 1 && (F[idx(i, j + 1, k)] < 0) !== v0) {
      quad(cellV[cidx(i - 1, j, k - 1)], cellV[cidx(i - 1, j, k)], cellV[cidx(i, j, k)], cellV[cidx(i, j, k - 1)], !v0);
    }
    if (k < nz - 1 && (F[idx(i, j, k + 1)] < 0) !== v0) {
      quad(cellV[cidx(i - 1, j - 1, k)], cellV[cidx(i, j - 1, k)], cellV[cidx(i, j, k)], cellV[cidx(i - 1, j, k)], !v0);
    }
  }
  // make orientation consistent with the SDF gradient (outward normals)
  let flips = 0;
  const h = 1e-3;
  for (let q = 0; q < tris.length; q += 2) {
    const t = tris[q];
    const p0 = verts[t[0]], p1 = verts[t[1]], p2 = verts[t[2]];
    const n = cross(sub(p1, p0), sub(p2, p0));
    const c = mul(add(add(p0, p1), p2), 1 / 3);
    const g = [sdf(add(c, [h, 0, 0])) - sdf(add(c, [-h, 0, 0])), sdf(add(c, [0, h, 0])) - sdf(add(c, [0, -h, 0])), sdf(add(c, [0, 0, h])) - sdf(add(c, [0, 0, -h]))];
    if (dot(n, g) < 0) {
      flips++;
      for (const tt of [tris[q], tris[q + 1]]) { const tmp = tt[1]; tt[1] = tt[2]; tt[2] = tmp; }
    }
  }
  console.log(`surface nets: ${verts.length} verts, ${tris.length} tris (${flips} quads flipped)`);
  return { verts, tris };
}

// ------------------------------------------------------------ QEM decimation
function decimate(verts, tris, target, importance) {
  const nV = verts.length;
  const pos = new Float64Array(nV * 3);
  verts.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; });
  const nF = tris.length;
  const F = new Int32Array(nF * 3);
  tris.forEach((t, i) => { F[i * 3] = t[0]; F[i * 3 + 1] = t[1]; F[i * 3 + 2] = t[2]; });
  const fAlive = new Uint8Array(nF).fill(1);
  const vAlive = new Uint8Array(nV).fill(1);
  const vVer = new Int32Array(nV);
  const vFaces = Array.from({ length: nV }, () => []);
  for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) vFaces[F[f * 3 + c]].push(f);
  const Q = new Float64Array(nV * 10);
  const P3 = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let f = 0; f < nF; f++) {
    const a = P3(F[f * 3]), b = P3(F[f * 3 + 1]), c = P3(F[f * 3 + 2]);
    const n = cross(sub(b, a), sub(c, a));
    const area2 = len(n);
    if (area2 < 1e-14) continue;
    const nn = mul(n, 1 / area2);
    const d = -dot(nn, a);
    const w = area2 * 0.5;
    const q = [nn[0] * nn[0], nn[0] * nn[1], nn[0] * nn[2], nn[0] * d, nn[1] * nn[1], nn[1] * nn[2], nn[1] * d, nn[2] * nn[2], nn[2] * d, d * d];
    for (let c = 0; c < 3; c++) {
      const v = F[f * 3 + c];
      const wi = w * importance(P3(v));
      for (let k = 0; k < 10; k++) Q[v * 10 + k] += q[k] * wi;
    }
  }
  const qErr = (q, x, y, z) =>
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const neighbors = (v) => {
    const s = new Set();
    for (const f of vFaces[v]) if (fAlive[f]) for (let c = 0; c < 3; c++) { const u = F[f * 3 + c]; if (u !== v) s.add(u); }
    return s;
  };
  const triQuality = (a, b, c) => {
    const n = cross(sub(b, a), sub(c, a));
    const A = len(n) * 0.5;
    const l = dot(sub(b, a), sub(b, a)) + dot(sub(c, b), sub(c, b)) + dot(sub(a, c), sub(a, c));
    return l > 0 ? (4 * Math.sqrt(3) * A) / l : 0;
  };
  const MINQ = +(process.env.MINQ || 0.03);
  const QW = +(process.env.QW || 0);
  // evaluate collapse of edge (a,b); returns null when invalid
  function evalEdge(a, b) {
    const q = new Float64Array(10);
    for (let k = 0; k < 10; k++) q[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const pa = P3(a), pb = P3(b);
    // solve for optimum
    const m = [q[0], q[1], q[2], q[1], q[4], q[5], q[2], q[5], q[7]];
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const cands = [];
    if (Math.abs(det) > 1e-12) {
      const r = [-q[3], -q[6], -q[8]];
      const inv = [
        (m[4] * m[8] - m[5] * m[7]), -(m[1] * m[8] - m[2] * m[7]), (m[1] * m[5] - m[2] * m[4]),
        -(m[3] * m[8] - m[5] * m[6]), (m[0] * m[8] - m[2] * m[6]), -(m[0] * m[5] - m[2] * m[3]),
        (m[3] * m[7] - m[4] * m[6]), -(m[0] * m[7] - m[1] * m[6]), (m[0] * m[4] - m[1] * m[3]),
      ];
      const p = [(inv[0] * r[0] + inv[1] * r[1] + inv[2] * r[2]) / det, (inv[3] * r[0] + inv[4] * r[1] + inv[5] * r[2]) / det, (inv[6] * r[0] + inv[7] * r[1] + inv[8] * r[2]) / det];
      // keep the optimum close to the edge
      const mid = lerp3(pa, pb, 0.5);
      if (len(sub(p, mid)) < len(sub(pa, pb)) * 1.5) cands.push(p);
    }
    cands.push(lerp3(pa, pb, 0.5), pa, pb);
    let best = null;
    for (const p of cands) {
      const e = qErr(q, p[0], p[1], p[2]);
      if (best && e >= best.e) continue;
      // geometric validity
      let ok = true;
      let minQ = 1;
      for (const v of [a, b]) {
        for (const f of vFaces[v]) {
          if (!fAlive[f]) continue;
          const t = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
          if ((t[0] === a || t[1] === a || t[2] === a) && (t[0] === b || t[1] === b || t[2] === b)) continue;
          const oldP = t.map(P3);
          const newP = t.map((u) => (u === a || u === b ? p : P3(u)));
          const n0 = cross(sub(oldP[1], oldP[0]), sub(oldP[2], oldP[0]));
          const n1 = cross(sub(newP[1], newP[0]), sub(newP[2], newP[0]));
          if (dot(norm(n0), norm(n1)) < 0.35) { ok = false; break; }
          const qq = triQuality(newP[0], newP[1], newP[2]);
          if (qq < MINQ) { ok = false; break; }
          minQ = Math.min(minQ, qq);
        }
        if (!ok) break;
      }
      if (!ok) continue;
      const L2 = dot(sub(pa, pb), sub(pa, pb));
      // small shape-quality regularizer keeps facets from turning into slivers
      const cost = e + QW * L2 * (1 - minQ) * (1 - minQ);
      if (!best || cost < best.cost) best = { e, cost, p };
    }
    return best;
  }
  // binary heap
  const heap = [];
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const pi = (i - 1) >> 1; if (heap[pi].cost <= heap[i].cost) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; } };
  const pop = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].cost < heap[m].cost) m = l; if (r < heap.length && heap[r].cost < heap[m].cost) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  const pushEdge = (a, b) => {
    const r = evalEdge(a, b);
    if (!r) return;
    push({ a, b, cost: r.cost, p: r.p, va: vVer[a], vb: vVer[b] });
  };
  for (let v = 0; v < nV; v++) for (const u of neighbors(v)) if (u > v) pushEdge(v, u);
  let alive = nF;
  const t0 = Date.now();
  while (alive > target && heap.length) {
    const it = pop();
    const { a, b } = it;
    if (!vAlive[a] || !vAlive[b] || vVer[a] !== it.va || vVer[b] !== it.vb) continue;
    // link condition
    const Na = neighbors(a), Nb = neighbors(b);
    if (!Na.has(b)) continue;
    let common = 0;
    for (const u of Na) if (Nb.has(u)) common++;
    if (common !== 2 || Na.size < 3 || Nb.size < 3) continue;
    // re-validate with current geometry (neighbors may have moved)
    const r = evalEdge(a, b);
    if (!r) continue;
    if (Math.abs(r.cost - it.cost) > 1e-12 + it.cost * 1e-6) { push({ a, b, cost: r.cost, p: r.p, va: vVer[a], vb: vVer[b] }); continue; }
    // collapse b into a
    pos[a * 3] = r.p[0]; pos[a * 3 + 1] = r.p[1]; pos[a * 3 + 2] = r.p[2];
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    for (const f of vFaces[b]) {
      if (!fAlive[f]) continue;
      const hasA = F[f * 3] === a || F[f * 3 + 1] === a || F[f * 3 + 2] === a;
      if (hasA) { fAlive[f] = 0; alive--; continue; }
      for (let c = 0; c < 3; c++) if (F[f * 3 + c] === b) F[f * 3 + c] = a;
      vFaces[a].push(f);
    }
    vFaces[a] = vFaces[a].filter((f) => fAlive[f]);
    vAlive[b] = 0;
    vVer[a]++;
    // edges around the neighbours are re-validated lazily when popped
    for (const u of neighbors(a)) pushEdge(a, u);
  }
  console.log(`decimated to ${alive} tris in ${Date.now() - t0}ms`);
  // compact
  const remap = new Int32Array(nV).fill(-1);
  const outV = [];
  const outF = [];
  for (let f = 0; f < nF; f++) {
    if (!fAlive[f]) continue;
    const t = [];
    for (let c = 0; c < 3; c++) {
      const v = F[f * 3 + c];
      if (remap[v] < 0) { remap[v] = outV.length; outV.push(P3(v)); }
      t.push(remap[v]);
    }
    outF.push(t);
  }
  return { verts: outV, tris: outF };
}

// ------------------------------------------------------------ skin weights
// Chains: [parentBone, [bone, jointStart, jointEnd]...]
const CHAINS = {
  armL: { parent: B.spine2, bones: [[B.clavicleL, JL.clav, JL.shoulder], [B.upperArmL, JL.shoulder, JL.elbow], [B.forearmL, JL.elbow, JL.wrist], [B.handL, JL.wrist, JL.handTip]], bands: [0.03, 0.05, 0.04, 0.025] },
  armR: { parent: B.spine2, bones: [[B.clavicleR, R(JL.clav), R(JL.shoulder)], [B.upperArmR, R(JL.shoulder), R(JL.elbow)], [B.forearmR, R(JL.elbow), R(JL.wrist)], [B.handR, R(JL.wrist), R(JL.handTip)]], bands: [0.03, 0.05, 0.04, 0.025] },
  legL: { parent: B.pelvis, bones: [[B.thighL, JL.hip, JL.knee], [B.shinL, JL.knee, JL.ankle], [B.footL, JL.ankle, JL.toe]], bands: [0.07, 0.05, 0.03] },
  legR: { parent: B.pelvis, bones: [[B.thighR, R(JL.hip), R(JL.knee)], [B.shinR, R(JL.knee), R(JL.ankle)], [B.footR, R(JL.ankle), R(JL.toe)]], bands: [0.07, 0.05, 0.03] },
};
function chainWeights(chainName, p) {
  const ch = CHAINS[chainName];
  // closest point on the polyline -> arc parameter s
  let best = Infinity, bestS = 0, acc = 0;
  const S = [];
  for (const [, a, b] of ch.bones) {
    const ab = sub(b, a); const L = len(ab);
    const t = clamp(dot(sub(p, a), ab) / (L * L), 0, 1);
    const d = len(sub(p, lerp3(a, b, t)));
    if (d < best) { best = d; bestS = acc + t * L; }
    S.push(acc); acc += L;
  }
  // unprojected parameter for the start of the chain (so the parent blend is continuous)
  {
    const [, a, b] = ch.bones[0];
    const ab = sub(b, a); const L = len(ab);
    const t = dot(sub(p, a), ab) / (L * L);
    if (t < 0) bestS = Math.min(bestS, t * L);
  }
  const w = new Map();
  const f = ch.bones.map((_, i) => smoothstep(S[i] - ch.bands[i], S[i] + ch.bands[i], bestS));
  w.set(ch.parent, 1 - f[0]);
  for (let i = 0; i < ch.bones.length; i++) {
    const next = i + 1 < ch.bones.length ? f[i + 1] : 0;
    w.set(ch.bones[i][0], (w.get(ch.bones[i][0]) || 0) + Math.max(0, f[i] - next));
  }
  if (chainName.startsWith('leg')) {
    // feet: everything at/under the ankle follows the (planted) foot rigidly
    const foot = ch.bones[2][0], shin = ch.bones[1][0];
    const fw = 1 - smoothstep(0.085, 0.13, p[1]);
    if (fw > 0) {
      const total = [...w.values()].reduce((s, x) => s + x, 0);
      for (const k of w.keys()) w.set(k, w.get(k) * (1 - fw));
      w.set(foot, (w.get(foot) || 0) + fw * total);
    }
    void shin;
  }
  return w;
}
function centerWeights(p) {
  const y = p[1];
  const f1 = smoothstep(0.99, 1.09, y); // pelvis -> spine1
  const f2 = smoothstep(1.13, 1.25, y); // spine1 -> spine2
  const f3 = smoothstep(1.43, 1.48, y); // spine2 -> neck
  const f4 = smoothstep(1.53, 1.575, y); // neck -> head
  const w = new Map();
  w.set(B.pelvis, 1 - f1);
  w.set(B.spine1, f1 - f2);
  const sp2 = f2 - f3;
  // rib cage breathing share
  const rc = [0, 1.29, 0.0];
  const dy = (y - rc[1]) / 0.16;
  const breathShare = 0.85 * Math.max(0, 1 - dy * dy) * (1 - smoothstep(0.13, 0.2, Math.abs(p[0])));
  w.set(B.spine2, sp2 * (1 - breathShare));
  w.set(B.breath, sp2 * breathShare);
  w.set(B.neck, f3 - f4);
  w.set(B.head, f4);
  return w;
}
function skinWeights(p) {
  // soft membership of each body part
  const D = {};
  let dmin = Infinity;
  for (const g of GROUPS) { D[g] = groupDist(g, p); dmin = Math.min(dmin, D[g]); }
  const sigma = 0.01;
  const total = new Map();
  let sum = 0;
  const memb = {};
  for (const g of GROUPS) { memb[g] = Math.exp(-(D[g] - dmin) / sigma); sum += memb[g]; }
  for (const g of GROUPS) {
    const m = memb[g] / sum;
    if (m < 0.01) continue;
    const w = g === 'center' ? centerWeights(p) : chainWeights(g, p);
    for (const [b, x] of w) if (x > 0) total.set(b, (total.get(b) || 0) + x * m);
  }
  const arr = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = arr.reduce((acc, e) => acc + e[1], 0);
  return arr.map(([b, x]) => [b, x / s]);
}

// ------------------------------------------------------------ topology check
function nonManifoldEdges(verts, tris) {
  const m = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[k], c = t[(k + 1) % 3];
    const key = a < c ? a * 1e7 + c : c * 1e7 + a;
    m.set(key, (m.get(key) || 0) + 1);
  }
  const bad = [];
  for (const [key, n] of m) if (n !== 2) bad.push({ n, p: verts[Math.floor(key / 1e7)].map((x) => +x.toFixed(3)) });
  return bad;
}

// ------------------------------------------------------------ run
const t0 = Date.now();
// retry with a slightly shifted grid if Surface Nets produced a non-manifold edge
let dense;
// (grid offset 0.2 voxel picked by eye among a few candidates; others are fallbacks)
const JITTERS = [process.env.JITTER !== undefined ? +process.env.JITTER : 0.2, 0.37, 0.61, 0.83];
for (const jitter of JITTERS) {
  dense = surfaceNets(jitter);
  const bad = nonManifoldEdges(dense.verts, dense.tris);
  if (!bad.length) break;
  console.log(`jitter ${jitter}: dense mesh non-manifold edges:`, bad.length, JSON.stringify(bad.slice(0, 5)));
}
// importance: keep a little more detail in head / hands / feet
const importance = (p) => {
  let w = 1;
  if (p[1] > 0.86 && p[1] < 1.45 && Math.abs(p[0]) < 0.16) w = +(process.env.TORSO_W || 0.6); // torso: big planar facets
  if (p[1] > 1.52) w = +(process.env.HEAD_W || 1.4); // head
  if (p[1] < 0.13) w = 2; // feet
  if (Math.abs(p[0]) > 0.24 && p[1] < 0.95) w = 2.5; // hands
  // knees / elbows keep a bit more detail
  const nearJoint = (j) => Math.hypot(Math.abs(p[0]) - j[0], p[1] - j[1], p[2] - j[2]) < 0.07;
  if (nearJoint(JL.knee) || nearJoint(JL.elbow)) w = Math.max(w, 1.5);
  return w;
};
const { verts, tris } = decimate(dense.verts, dense.tris, TARGET_TRIS, importance);
{
  const bad = nonManifoldEdges(verts, tris);
  if (bad.length) console.log('WARNING decimated mesh non-manifold edges:', bad.length, JSON.stringify(bad.slice(0, 5)));
}

// snap soles
let minY = Infinity;
for (const v of verts) minY = Math.min(minY, v[1]);
for (const v of verts) { v[1] -= minY; if (v[1] < 0.003) v[1] = 0; }
console.log(`minY shift ${minY.toFixed(4)}`);

// quantize (0.1 mm)
const QS = 10000;
const POS = [];
for (const v of verts) POS.push(Math.round(v[0] * QS), Math.round(v[1] * QS), Math.round(v[2] * QS));
const IDX = tris.flat();
const SKIN_I = [], SKIN_W = [];
for (const v of verts) {
  const w = skinWeights(v);
  const ints = w.map(([, x]) => Math.round(x * 255));
  const diff = 255 - ints.reduce((a, b) => a + b, 0);
  ints[0] += diff;
  for (let k = 0; k < 4; k++) { SKIN_I.push(k < w.length ? w[k][0] : 0); SKIN_W.push(k < w.length ? ints[k] : 0); }
}
const round4 = (p) => p.map((x) => +x.toFixed(4));
const bonesOut = BONES.map((b) => ({ name: b.name, parent: b.parent, pos: round4(b.pos) }));
const src = `// GENERATED by bake.mjs — do not edit by hand.
// ${tris.length} triangles, ${verts.length} vertices (SDF sculpt -> surface nets -> QEM decimation).
// Positions are quantized to 0.1 mm (divide by POS_SCALE). Skin weights are 0..255 per vertex (4 influences).
export const POS_SCALE = ${QS};
export const BONES = ${JSON.stringify(bonesOut)};
export const POS = new Int16Array(${JSON.stringify(POS)});
export const IDX = new Uint16Array(${JSON.stringify(IDX)});
export const SKIN_I = new Uint8Array(${JSON.stringify(SKIN_I)});
export const SKIN_W = new Uint8Array(${JSON.stringify(SKIN_W)});
export const JOINTS = ${JSON.stringify(Object.fromEntries(['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'wrist'].map((k) => [k, round4(JL[k])])))};
`;
writeFileSync(join(HERE, 'data.js'), src);
console.log(`wrote data.js: ${tris.length} tris, ${verts.length} verts, ${(src.length / 1024).toFixed(1)} KB, total ${Date.now() - t0}ms`);
