// Low-poly "sculpted" mannequin: hand-authored edge loops (data.js), bridged into
// a single closed mesh, skinned to a small skeleton, with a calm idle animation.
import * as THREE from 'three';
import * as D from './data.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ tiny vec3 helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p) => [-p[0], p[1], p[2]];
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function closestOnSeg(p, a, b) {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / dot(ab, ab)));
  return lerp(a, b, t);
}

// ------------------------------------------------------------------ skeleton layout
const BONES = [
  ['hips', null],
  ['spine', 'hips'],
  ['chest', 'spine'],
  ['neck', 'chest'],
  ['head', 'neck'],
  ['clav_L', 'chest'],
  ['uarm_L', 'clav_L'],
  ['farm_L', 'uarm_L'],
  ['hand_L', 'farm_L'],
  ['clav_R', 'chest'],
  ['uarm_R', 'clav_R'],
  ['farm_R', 'uarm_R'],
  ['hand_R', 'farm_R'],
  ['thigh_L', 'hips'],
  ['shin_L', 'thigh_L'],
  ['foot_L', 'shin_L'],
  ['thigh_R', 'hips'],
  ['shin_R', 'thigh_R'],
  ['foot_R', 'shin_R'],
];
const BONE_INDEX = Object.fromEntries(BONES.map(([n], i) => [n, i]));
const SIDED = new Set(['clav', 'uarm', 'farm', 'hand', 'thigh', 'shin', 'foot']);

// the data is authored slightly tall; everything is scaled uniformly to the target height
const SCALE = D.HEIGHT / D.HEAD_TOP[1];

function jointPos(name) {
  const base = name.replace(/_[LR]$/, '');
  const p = mul(D.JOINTS[base], SCALE);
  return name.endsWith('_R') ? mirror(p) : p;
}

function resolveWeights(w, side) {
  const out = {};
  for (const k in w) out[SIDED.has(k) ? `${k}_${side}` : k] = w[k];
  return out;
}

// ------------------------------------------------------------------ mesh builder
function buildMesh() {
  const P = []; // positions
  const W = []; // weight maps
  const F = []; // faces [a, b, c, group]
  const G = []; // groups: insideSegments per bridge/fan call
  const vert = (p, w) => (P.push(p.slice()), W.push(w), P.length - 1);
  // along-axis scatter so edge loops do not read as clean horizontal bands
  const rj = mulberry32(0x0b0d1e5);
  const scatter = (amp) => (rj() - 0.5) * 2 * amp;

  // param along a polyline (by arc length), normalised 0..1; closed adds the wrap edge
  const params = (ring, closed) => {
    const u = [0];
    let L = 0;
    const m = closed ? ring.length : ring.length - 1;
    for (let i = 0; i < m; i++) {
      L += len(sub(P[ring[(i + 1) % ring.length]], P[ring[i]]));
      u.push(L);
    }
    return u.map((x) => x / (L || 1));
  };
  // rotate closed ring B so it starts at the vertex nearest A[0]
  const alignStart = (A, B) => {
    let best = 0;
    let bd = Infinity;
    B.forEach((vi, i) => {
      const d = len(sub(P[vi], P[A[0]]));
      if (d < bd) (bd = d), (best = i);
    });
    return B.slice(best).concat(B.slice(0, best));
  };
  // triangulate the strip between two loops (explicit faces, balanced by arc length)
  const bridge = (A, B, closed, inside) => {
    const gi = G.push(inside) - 1;
    if (closed) B = alignStart(A, B);
    const ua = params(A, closed);
    const ub = params(B, closed);
    const na = closed ? A.length : A.length - 1;
    const nb = closed ? B.length : B.length - 1;
    let i = 0;
    let j = 0;
    while (i < na || j < nb) {
      let advA;
      if (i >= na) advA = false;
      else if (j >= nb) advA = true;
      else advA = Math.abs(ua[i + 1] - ub[j]) <= Math.abs(ub[j + 1] - ua[i]);
      const a0 = A[i % A.length];
      const b0 = B[j % B.length];
      if (advA) {
        F.push([a0, A[(i + 1) % A.length], b0, gi]);
        i++;
      } else {
        F.push([a0, B[(j + 1) % B.length], b0, gi]);
        j++;
      }
    }
  };
  const fan = (ring, centre, inside) => {
    const gi = G.push(inside) - 1;
    for (let i = 0; i < ring.length; i++) F.push([ring[i], ring[(i + 1) % ring.length], centre, gi]);
  };

  const SPINE_AXIS = [[[0, 0.8, -0.005], [0, 1.52, -0.01]]];

  // half ring (front -> left side -> back) to a full closed ring; x = 0 end points are
  // shared centre-line vertices, otherwise the end points are mirrored pairs.
  const fullRing = (ring) => {
    const half = ring.pts;
    const wOf = (p, side) => resolveWeights(p[3] || ring.w, side);
    const jy = ring.jy ?? 0;
    const at = (p) => [p[0], p[1] + scatter(jy), p[2]];
    const L = half.map((p) => vert(at(p), wOf(p, 'L')));
    const R = half.map((p, i) => (p[0] === 0 ? L[i] : vert(at(mirror(p)), wOf(p, 'R'))));
    const full = L.slice();
    for (let i = half.length - 1; i >= 0; i--) if (half[i][0] !== 0) full.push(R[i]);
    return { L, R, full };
  };

  // ---------------- torso
  const torso = {};
  for (const key of D.TORSO_ORDER) torso[key] = fullRing(D.TORSO[key]);
  torso.crotch = vert(D.TORSO.CROTCH, { hips: 1 });
  const order = D.TORSO_ORDER;
  for (let k = 0; k < order.length - 2; k++) bridge(torso[order[k]].full, torso[order[k + 1]].full, true, SPINE_AXIS);
  // armpit ring -> shoulder ring, leaving the two arm holes open: front and back patches
  {
    const A = torso.A;
    const S = torso.S;
    const { faf, paf } = D.ARMHOLE.A;
    const { af, ab } = D.ARMHOLE.S;
    // open polylines across the chest (right hole -> left hole) and across the back
    const span = (ring, from, to, back) => {
      const n = ring.L.length;
      const left = back ? ring.L.slice(from, n) : ring.L.slice(0, to + 1);
      const right = back ? ring.R.slice(from, n - 1).reverse() : ring.R.slice(1, to + 1).reverse();
      return back ? left.concat(right) : right.concat(left);
    };
    bridge(span(A, 0, faf, false), span(S, 0, af, false), false, SPINE_AXIS);
    bridge(span(A, paf, 0, true), span(S, ab, 0, true), false, SPINE_AXIS);
  }

  // ---------------- neck + head
  const headRings = D.HEAD.map((ring) => fullRing(ring).full);
  const HEAD_AXIS = [[[0, 1.4, -0.01], [0, 1.55, -0.005]], [[0, 1.55, -0.005], [0, 1.7, 0.0]]];
  bridge(torso.S.full, headRings[0], true, HEAD_AXIS);
  for (let k = 0; k < headRings.length - 1; k++) bridge(headRings[k], headRings[k + 1], true, HEAD_AXIS);
  fan(headRings[headRings.length - 1], vert(D.HEAD_TOP, { head: 1 }), HEAD_AXIS);

  // ---------------- limbs (per side)
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const S = (p) => (side === 'L' ? p.slice() : mirror(p));
    const J = (n) => S(D.JOINTS[n]);
    const segs = {
      uarm: [J('uarm'), J('farm')],
      farm: [J('farm'), J('hand')],
      hand: [J('hand'), J('handEnd')],
      thigh: [J('thigh'), J('shin')],
      shin: [J('shin'), J('foot')],
    };
    const frameOf = (seg) => {
      const [a, b] = segs[seg];
      const axis = norm(sub(b, a));
      const fwd = norm(sub([0, 0, 1], mul(axis, axis[2])));
      const out = mul(cross(fwd, axis), sx); // lateral for both sides
      if (seg === 'hand') {
        // turn the mitten so its broad side faces medially-backward
        const tw = D.HAND_TWIST * DEG;
        const f2 = sub(mul(fwd, Math.cos(tw)), mul(out, Math.sin(tw)));
        const o2 = add(mul(out, Math.cos(tw)), mul(fwd, Math.sin(tw)));
        return { a, b, axis, fwd: f2, out: o2 };
      }
      return { a, b, axis, fwd, out };
    };
    // chain weights by projection onto the bone segments (smooth blends at joints)
    const chainWeights = (p, chain, blends) => {
      let best = null;
      let s0 = 0;
      for (let k = 0; k < chain.length; k++) {
        const [a, b] = chain[k];
        const q = closestOnSeg(p, a, b);
        const d = len(sub(p, q));
        const s = s0 + len(sub(q, a));
        if (!best || d < best.d - 1e-9) best = { d, s };
        s0 += len(sub(b, a));
      }
      return best.s;
    };
    const ringOn = (seg, t, pts, off, jitter = 0) => {
      const f = frameOf(seg);
      let c = lerp(f.a, f.b, t);
      if (off) c = add(c, add(mul(f.out, off[0]), mul(f.fwd, off[1])));
      return pts.map(([phi, r, da = 0]) => {
        const ph = phi * DEG;
        const along = da + scatter(jitter);
        return add(c, add(add(mul(f.fwd, r * Math.cos(ph)), mul(f.out, r * Math.sin(ph))), mul(f.axis, along)));
      });
    };
    // close a ring: 4 points -> flat quad (mitten tip), otherwise fan to an apex
    const cap = (ring, apex, w, inside) => {
      if (!apex) {
        const gi = G.push(inside) - 1;
        F.push([ring[0], ring[1], ring[2], gi], [ring[0], ring[2], ring[3], gi]);
      } else fan(ring, vert(apex, w), inside);
    };

    // ---- arm
    const armChain = [segs.uarm, segs.farm, segs.hand];
    const sE = len(sub(segs.uarm[1], segs.uarm[0]));
    const sW = sE + len(sub(segs.farm[1], segs.farm[0]));
    const armW = (p) => {
      const s = chainWeights(p, armChain);
      const e = smooth(sE - 0.045, sE + 0.045, s);
      const w = smooth(sW - 0.03, sW + 0.03, s);
      return { [`uarm_${side}`]: 1 - e, [`farm_${side}`]: e - w, [`hand_${side}`]: w };
    };
    const HA = D.ARMHOLE.A;
    const HS = D.ARMHOLE.S;
    const hole = [
      torso.S[side][HS.af],
      torso.S[side][HS.at],
      torso.S[side][HS.ab],
      torso.A[side][HA.paf],
      torso.A[side][HA.ax],
      torso.A[side][HA.faf],
    ];
    const delt = D.DELTOID.pts.map((p) => vert(S(p), resolveWeights(D.DELTOID.w, side)));
    const ARM_AXIS = [segs.uarm, segs.farm, segs.hand];
    bridge(hole, delt, true, [[J('uarm'), segs.uarm[1]]]);
    let prev = delt;
    for (const [seg, t, pts, off, jit] of D.ARM) {
      const ring = ringOn(seg, t, pts, off, jit).map((p) => vert(p, armW(p)));
      bridge(prev, ring, true, ARM_AXIS);
      prev = ring;
    }
    cap(prev, null, null, [[segs.hand[0], lerp(segs.hand[0], segs.hand[1], 0.8)]]);

    // ---- leg
    const legChain = [segs.thigh, segs.shin];
    const sK = len(sub(segs.thigh[1], segs.thigh[0]));
    const legW = (p) => {
      const s = chainWeights(p, legChain);
      const k = smooth(sK - 0.05, sK + 0.05, s);
      return { [`thigh_${side}`]: 1 - k, [`shin_${side}`]: k };
    };
    const P0 = torso.P0;
    const crotch = torso.crotch;
    const top = [P0.L[0], ...P0[side].slice(1, 6), P0.L[6], crotch];
    const LEG_AXIS = [segs.thigh, segs.shin];
    prev = top;
    for (const [seg, t, pts, off, jit] of D.LEG) {
      const ring = ringOn(seg, t, pts, off, jit).map((p) => vert(p, legW(p)));
      bridge(prev, ring, true, LEG_AXIS);
      prev = ring;
    }
    // ---- foot (relative to ankle; toe-out yaw)
    const ank = J('foot');
    const yaw = D.TOE_OUT * DEG;
    const footPt = (p) => {
      const x = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw);
      const z = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
      return [ank[0] + x * sx, p[1], ank[2] + z];
    };
    const FOOT_AXIS = [
      [segs.shin[0], ank],
      [footPt([0, 0.045, -0.03]), footPt([-0.008, 0.016, 0.12])],
    ];
    D.FOOT.forEach((ring, k) => {
      const r = ring.pts.map((p) => vert(footPt(p), resolveWeights(ring.w, side)));
      bridge(prev, r, true, k === 0 ? LEG_AXIS : FOOT_AXIS);
      prev = r;
    });
    {
      const last = D.FOOT[D.FOOT.length - 1].pts;
      const c = mul(last.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / last.length);
      fan(prev, vert(footPt(add(c, D.TOE_TIP)), { [`foot_${side}`]: 1 }), FOOT_AXIS);
    }
  }

  return { P, W, F, G };
}

// ------------------------------------------------------------------ irregular retriangulation
// Seeded random edge flips across nearly-flat edges: the vertices (and so the silhouette)
// stay where they were sculpted, but the regular strip pattern turns into the irregular
// long/short facet mix of a decimated scan.
function flipEdges(tris, V, rnd, maxDihedralDeg, prob) {
  const ek = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);
  const edges = new Map();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = ek(t[k], t[(k + 1) % 3]);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(i);
    }
  });
  const nrm = (t) => norm(cross(sub(V[t[1]], V[t[0]]), sub(V[t[2]], V[t[0]])));
  const minAngle = (t) => {
    let m = Math.PI;
    for (let k = 0; k < 3; k++) {
      const u = norm(sub(V[t[(k + 1) % 3]], V[t[k]]));
      const w = norm(sub(V[t[(k + 2) % 3]], V[t[k]]));
      m = Math.min(m, Math.acos(Math.max(-1, Math.min(1, dot(u, w)))));
    }
    return m;
  };
  const cosMax = Math.cos(maxDihedralDeg * DEG);
  const keys = [...edges.keys()].sort((x, y) => x - y);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  let flips = 0;
  for (const key of keys) {
    const fs = edges.get(key);
    if (!fs || fs.length !== 2 || rnd() > prob) continue;
    let [f1, f2] = fs;
    const u = Math.floor(key / 65536);
    const v = key % 65536;
    // orient: f1 must contain the directed edge a -> b
    let t1 = tris[f1];
    let k1 = t1.findIndex((x, k) => (x === u && t1[(k + 1) % 3] === v) || (x === v && t1[(k + 1) % 3] === u));
    if (k1 < 0) continue;
    const a = t1[k1];
    const b = t1[(k1 + 1) % 3];
    const c = t1[(k1 + 2) % 3];
    const t2 = tris[f2];
    const d = t2.find((x) => x !== a && x !== b);
    if (d === undefined || c === d || edges.has(ek(c, d))) continue;
    const n1 = nrm(t1);
    const n2 = nrm(t2);
    if (dot(n1, n2) < cosMax) continue;
    const na = [a, d, c];
    const nb = [b, c, d];
    const navg = norm(add(n1, n2));
    if (dot(nrm(na), navg) < 0.85 || dot(nrm(nb), navg) < 0.85) continue;
    if (Math.min(minAngle(na), minAngle(nb)) < 9 * DEG) continue;
    tris[f1] = na;
    tris[f2] = nb;
    edges.delete(key);
    edges.set(ek(c, d), [f1, f2]);
    const swapRef = (x, y, from, to) => {
      const l = edges.get(ek(x, y));
      l[l.indexOf(from)] = to;
    };
    swapRef(b, c, f1, f2);
    swapRef(a, d, f2, f1);
    flips++;
  }
  return flips;
}

// ------------------------------------------------------------------ geometry assembly
function makeGeometry(opts) {
  const { P, W, F, G } = buildMesh();
  const rnd = mulberry32(0x5eed1234);

  // orientation: every strip is built with a consistent winding, so one outward/inward
  // vote per strip (normal vs. the nearest inside bone segment) orients it robustly.
  const votes = new Float32Array(G.length);
  for (const [a, b, c, gi] of F) {
    const n = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    const g = mul(add(add(P[a], P[b]), P[c]), 1 / 3);
    let best = null;
    let bd = Infinity;
    for (const [s0, s1] of G[gi]) {
      const q = closestOnSeg(g, s0, s1);
      const d = len(sub(g, q));
      if (d < bd) (bd = d), (best = q);
    }
    votes[gi] += Math.sign(dot(n, sub(g, best)));
  }

  // decimated-scan irregularity: small seeded jitter (shared verts stay welded)
  const J = P.map((p) => {
    const j = 0.0035;
    const d = [(rnd() - 0.5) * 2 * j, (rnd() - 0.5) * 2 * j, (rnd() - 0.5) * 2 * j];
    if (p[1] <= 0.0005) d[1] = 0; // sole stays on the ground
    return mul(add(p, d), SCALE);
  });

  const TRIS = F.map(([a, b, c, gi]) => (votes[gi] >= 0 ? [a, b, c] : [a, c, b]));
  flipEdges(TRIS, J, mulberry32(0xf11b5), 16, 0.5);

  const nT = TRIS.length;
  const pos = new Float32Array(nT * 9);
  const bary = new Float32Array(nT * 9);
  const col = new Float32Array(nT * 9);
  const sIdx = new Uint16Array(nT * 12);
  const sWgt = new Float32Array(nT * 12);
  const breath = new Float32Array(nT * 9);

  // per-vertex skin data
  const vIdx = [];
  const vWgt = [];
  for (const w of W) {
    const e = Object.entries(w)
      .filter(([, v]) => v > 1e-4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const tot = e.reduce((s, [, v]) => s + v, 0) || 1;
    const idx = [0, 0, 0, 0];
    const wg = [0, 0, 0, 0];
    e.forEach(([k, v], i) => {
      if (!(k in BONE_INDEX)) throw new Error('unknown bone ' + k);
      idx[i] = BONE_INDEX[k];
      wg[i] = v / tot;
    });
    vIdx.push(idx);
    vWgt.push(wg);
  }
  // breathing morph: expand chest / upper torso, lift slightly
  const breathDelta = (p, w) => {
    const torsoW = (w.chest || 0) + (w.spine || 0) * 0.5 + (w.neck || 0) * 0.3;
    if (!torsoW) return [0, 0, 0];
    const fy = smooth(1.08, 1.24, p[1]) * (1 - smooth(1.36, 1.47, p[1]));
    const f = fy * Math.min(1, torsoW);
    const front = Math.max(0, p[2] + 0.02);
    return [p[0] * 0.02 * f, 0.002 * f, (front * 0.05 + (p[2] + 0.02) * 0.01) * f];
  };

  const base = new THREE.Color();
  const tint = new THREE.Color(opts.baseColor ?? 0xffffff);
  const c = new THREE.Color();
  for (let t = 0; t < nT; t++) {
    const tri = TRIS[t];

    // facet colour: warm neutral grey, slight per-triangle variation, rare highlights
    const r = rnd();
    // downward facets get a little extra albedo so under-jaw / armpit planes do not go black
    const pa = J[tri[0]];
    const fn = norm(cross(sub(J[tri[1]], pa), sub(J[tri[2]], pa)));
    let v = 0.62 + (rnd() - 0.5) * 0.2 + 0.22 * Math.max(0, -fn[1]);
    if (r > 0.95) v += 0.14;
    const warm = 0.015 + (rnd() - 0.5) * 0.03;
    base.setRGB(v + warm, v + warm * 0.55, v - warm * 0.9, THREE.SRGBColorSpace);
    c.copy(base).multiply(tint);

    for (let k = 0; k < 3; k++) {
      const vi = tri[k];
      const o = t * 9 + k * 3;
      pos[o] = J[vi][0];
      pos[o + 1] = J[vi][1];
      pos[o + 2] = J[vi][2];
      bary[o + k] = 1;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
      const bd3 = mul(breathDelta(P[vi], W[vi]), SCALE);
      breath[o] = bd3[0];
      breath[o + 1] = bd3[1];
      breath[o + 2] = bd3[2];
      for (let q = 0; q < 4; q++) {
        sIdx[t * 12 + k * 4 + q] = vIdx[vi][q];
        sWgt[t * 12 + k * 4 + q] = vWgt[vi][q];
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sWgt, 4));
  geo.morphAttributes.position = [new THREE.BufferAttribute(breath, 3)];
  geo.morphTargetsRelative = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------ material (flat + triangle edges)
function makeMaterial(opts) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
  });
  const uniforms = {
    uEdgeColor: { value: new THREE.Color(opts.edgeColor ?? 0x1a1a1a) },
    uEdgeOpacity: { value: opts.edgeOpacity ?? 1 },
    uEdgeWidth: { value: 0.7 },
    uLift: { value: 0.1 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bary;\nvarying vec3 vBary;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBary = bary;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBary;\nuniform vec3 uEdgeColor;\nuniform float uEdgeOpacity;\nuniform float uEdgeWidth;\nuniform float uLift;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uLift;',
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          vec3 fw = max(fwidth(vBary), vec3(1e-6));
          vec3 dpx = vBary / fw;
          float dmin = min(min(dpx.x, dpx.y), dpx.z);
          float line = 1.0 - smoothstep(uEdgeWidth - 0.5, uEdgeWidth + 0.5, dmin);
          float triPx = 1.0 / max(max(fw.x, fw.y), fw.z);
          float fade = mix(0.3, 1.0, smoothstep(2.5, 10.0, triPx));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, line * uEdgeOpacity * fade);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'sculpted-edges-v1';
  return mat;
}

// ------------------------------------------------------------------ public API
export function createFigure(options = {}) {
  const geometry = makeGeometry(options);
  const material = makeMaterial(options);

  // skeleton (bind pose = rest pose, identity rotations)
  const bones = [];
  const byName = {};
  for (const [name, parent] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = jointPos(name);
    if (parent) {
      const pp = jointPos(parent);
      b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      byName[parent].add(b);
    } else b.position.set(p[0], p[1], p[2]);
    bones.push(b);
    byName[name] = b;
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'sculpted-figure';
  mesh.add(byName.hips);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;

  const object = new THREE.Group();
  object.name = 'figure';
  object.add(mesh);

  // ---------------- idle animation (pure function of t)
  const rig = createIdle(byName, mesh);
  rig.update(0);

  return {
    object,
    update(t) {
      rig.update(t);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      skeleton.dispose();
    },
  };
}

// ------------------------------------------------------------------ idle rig
function createIdle(B, mesh) {
  const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const rest = {};
  for (const name of Object.keys(B)) rest[name] = B[name].position.clone();
  const hipsRest = v3(jointPos('hips'));

  // leg IK constants (model space, rest)
  const legs = ['L', 'R'].map((s) => {
    const H = v3(jointPos(`thigh_${s}`));
    const K = v3(jointPos(`shin_${s}`));
    const A = v3(jointPos(`foot_${s}`));
    const L1 = H.distanceTo(K);
    const L2 = K.distanceTo(A);
    const dir1 = K.clone().sub(H).normalize();
    const dir2 = A.clone().sub(K).normalize();
    const hipLocal = H.clone().sub(hipsRest);
    // pole: knee offset from hip-ankle line
    const n0 = A.clone().sub(H).normalize();
    const pole = K.clone().sub(H);
    pole.addScaledVector(n0, -pole.dot(n0)).normalize();
    return { s, A, L1, L2, dir1, dir2, hipLocal, pole, thigh: B[`thigh_${s}`], shin: B[`shin_${s}`], foot: B[`foot_${s}`] };
  });

  const e = new THREE.Euler();
  const qP = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  const qS = new THREE.Quaternion();
  const qInv = new THREE.Quaternion();
  const hipW = new THREE.Vector3();
  const n = new THREE.Vector3();
  const pp = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const d1 = new THREE.Vector3();
  const d2 = new THREE.Vector3();

  const setRot = (bone, x, y, z) => bone.quaternion.setFromEuler(e.set(x, y, z, 'XYZ'));

  function update(t) {
    // --- drivers (incommensurate periods, all pure functions of t)
    const breath = 0.5 - 0.5 * Math.cos((TAU * t) / 4.7) + 0.06 * Math.sin((TAU * t) / 2.35);
    const wsh = 0.82 * Math.sin((TAU * t) / 10.6 + 0.4) + 0.18 * Math.sin((TAU * t) / 17.3 + 1.7);
    const wshLag = 0.82 * Math.sin((TAU * (t - 0.9)) / 10.6 + 0.4) + 0.18 * Math.sin((TAU * (t - 0.9)) / 17.3 + 1.7);
    const yawDrift = 0.6 * Math.sin((TAU * t) / 13.7 + 0.3) + 0.4 * Math.sin((TAU * t) / 7.9 + 2.1);
    const pitchDrift = 0.55 * Math.sin((TAU * t) / 11.3 + 1.2) + 0.45 * Math.sin((TAU * t) / 6.1 + 0.2);

    // --- pelvis: lateral shift + roll, lowered so the higher hip never over-extends
    const roll = 1.5 * DEG * wsh;
    const hipsB = B.hips;
    hipsB.position.set(
      hipsRest.x + 0.02 * wsh,
      hipsRest.y - 0.09 * Math.abs(Math.sin(roll)) - 0.0008,
      hipsRest.z + 0.002 * Math.sin((TAU * t) / 10.6 * 2 + 0.7),
    );
    hipsB.quaternion.setFromEuler(e.set(0.3 * DEG * Math.sin((TAU * t) / 10.6 * 2), 0.8 * DEG * wsh, roll, 'XYZ'));
    qP.copy(hipsB.quaternion);

    // --- spine counter-rotation (contrapposto) + breathing extension
    setRot(B.spine, -0.25 * DEG * breath, -0.4 * DEG * wsh, -1.1 * DEG * wsh);
    setRot(B.chest, -0.55 * DEG * breath, -0.3 * DEG * wsh, -0.9 * DEG * wsh);
    setRot(B.neck, 0.3 * DEG * breath + 1.0 * DEG * pitchDrift, 1.2 * DEG * yawDrift, 0.3 * DEG * wsh);
    setRot(B.head, 1.3 * DEG * pitchDrift, 1.8 * DEG * yawDrift, 0.4 * DEG * wsh + 0.4 * DEG * Math.sin((TAU * t) / 15.1));

    // --- shoulders lift with the breath, arms hang with a lagging sway
    const lift = 0.9 * DEG * breath;
    setRot(B.clav_L, 0, 0, lift);
    setRot(B.clav_R, 0, 0, -lift);
    const swayX = 1.1 * DEG * Math.sin((TAU * (t - 0.6)) / 10.6 * 2 + 0.9) + 0.5 * DEG * Math.sin((TAU * t) / 6.7);
    const abd = 1.2 * DEG * wshLag; // counter the chest roll with lag so arms keep hanging
    setRot(B.uarm_L, swayX, 0, abd * 0.9 - lift * 0.8 + 0.3 * DEG * breath);
    setRot(B.uarm_R, swayX * 0.9, 0, abd * 0.9 + lift * 0.8 - 0.3 * DEG * breath);
    const flex = -(1.0 * DEG) * Math.sin((TAU * (t - 1.2)) / 9.3);
    setRot(B.farm_L, flex, 0, 0);
    setRot(B.farm_R, flex * 0.8, 0, 0);
    setRot(B.hand_L, 0.8 * DEG * Math.sin((TAU * t) / 8.1), 0, 0);
    setRot(B.hand_R, 0.8 * DEG * Math.sin((TAU * t) / 8.9 + 1), 0, 0);

    // --- legs: analytic two-bone IK so the feet stay planted
    for (const L of legs) {
      hipW.copy(L.hipLocal).applyQuaternion(qP).add(hipsB.position);
      n.copy(L.A).sub(hipW);
      let d = n.length();
      n.divideScalar(d);
      d = Math.min(Math.max(d, Math.abs(L.L1 - L.L2) + 1e-4), L.L1 + L.L2 - 1e-5);
      const cosA = (L.L1 * L.L1 + d * d - L.L2 * L.L2) / (2 * L.L1 * d);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      pp.copy(L.pole).addScaledVector(n, -L.pole.dot(n)).normalize();
      knee.copy(hipW).addScaledVector(n, L.L1 * cosA).addScaledVector(pp, L.L1 * sinA);
      d1.copy(knee).sub(hipW).normalize();
      d2.copy(L.A).sub(knee).normalize();
      qT.setFromUnitVectors(L.dir1, d1);
      qS.setFromUnitVectors(L.dir2, d2);
      L.thigh.quaternion.copy(qInv.copy(qP).invert()).multiply(qT);
      L.shin.quaternion.copy(qInv.copy(qT).invert()).multiply(qS);
      L.foot.quaternion.copy(qS).invert();
    }

    mesh.morphTargetInfluences[0] = breath;
  }
  return { update };
}
