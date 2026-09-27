// Bake-time generator for the "skinned-loft" figure.
// Pure JS, no three.js, deterministic (seeded PRNG). Run via bake.mjs, which
// writes data.js consumed at runtime by figure.js.
//
// Pipeline:
//   1. skeleton joints (bind pose == relaxed standing rest pose)
//   2. anatomical cross-section rings lofted along torso / legs / arms / neck-head,
//      stitched into ONE closed manifold (pants topology at the crotch,
//      hand-authored shoulder yoke with arm + neck outlets)
//   3. consistent orientation, manifold check
//   4. irregularisation: QEM-guided random edge merges, random edge flips,
//      seeded vertex jitter  -> decimated-scan look
//   5. skin weights from distance to bone segments (per-region bone sets)

// ---------------------------------------------------------------- math utils
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a, b) => len(sub(a, b));
const orth = (v, t) => norm(sub(v, mul(t, dot(v, t))));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- skeleton
// Left-side joints (x > 0 is the figure's left; figure faces +Z). Meters.
export const J = {
  pelvis: [0, 0.95, 0.0],
  spine1: [0, 1.04, -0.012],
  spine2: [0, 1.2, -0.016],
  breath: [0, 1.27, 0.0],
  neck: [0, 1.45, -0.02],
  head: [0, 1.55, -0.006],
  headTop: [0, 1.75, -0.012],
  clav: [0.035, 1.42, 0.0],
  shoulder: [0.18, 1.395, -0.012],
  elbow: [0.225, 1.11, -0.036],
  wrist: [0.262, 0.86, 0.004],
  handTip: [0.272, 0.685, 0.03],
  hip: [0.088, 0.915, 0.0],
  knee: [0.1, 0.5, 0.02],
  ankle: [0.112, 0.082, -0.022],
  toe: [0.135, 0.015, 0.17],
};

const mir = (p, s) => [p[0] * s, p[1], p[2]];

// name, parent, head position, segment tail used for weighting
export function buildBones() {
  const bones = [];
  const add_ = (name, parent, head, tail) => { bones.push({ name, parent, head, tail }); return bones.length - 1; };
  const pelvis = add_('pelvis', -1, J.pelvis, null);
  const spine1 = add_('spine1', pelvis, J.spine1, null);
  const spine2 = add_('spine2', spine1, J.spine2, null);
  const neck = add_('neck', spine2, J.neck, null);
  add_('head', neck, J.head, null);
  add_('breath', spine2, J.breath, null);
  for (const [sfx, s] of [['L', 1], ['R', -1]]) {
    const c = add_('clavicle' + sfx, spine2, mir(J.clav, s), null);
    const u = add_('upperArm' + sfx, c, mir(J.shoulder, s), null);
    const f = add_('forearm' + sfx, u, mir(J.elbow, s), null);
    add_('hand' + sfx, f, mir(J.wrist, s), null);
  }
  for (const [sfx, s] of [['L', 1], ['R', -1]]) {
    const th = add_('thigh' + sfx, pelvis, mir(J.hip, s), null);
    const sh = add_('shin' + sfx, th, mir(J.knee, s), null);
    add_('foot' + sfx, sh, mir(J.ankle, s), null);
  }
  // weighting segments
  const seg = {
    pelvis: [[0, 0.87, -0.01], [0, 1.02, -0.01]],
    spine1: [[0, 1.02, -0.012], [0, 1.19, -0.016]],
    spine2: [[0, 1.19, -0.016], [0, 1.44, -0.022]],
    neck: [[0, 1.45, -0.02], [0, 1.55, -0.006]],
    head: [[0, 1.585, -0.005], [0, 1.7, -0.01]],
  };
  for (const [sfx, s] of [['L', 1], ['R', -1]]) {
    seg['clavicle' + sfx] = [mir([0.04, 1.425, 0.0], s), mir(J.shoulder, s)];
    seg['upperArm' + sfx] = [mir(J.shoulder, s), mir(J.elbow, s)];
    seg['forearm' + sfx] = [mir(J.elbow, s), mir(J.wrist, s)];
    seg['hand' + sfx] = [mir(J.wrist, s), mir(J.handTip, s)];
    seg['thigh' + sfx] = [mir(J.hip, s), mir(J.knee, s)];
    seg['shin' + sfx] = [mir(J.knee, s), mir(J.ankle, s)];
    seg['foot' + sfx] = [mir(J.ankle, s), mir(J.toe, s)];
  }
  for (const b of bones) b.seg = seg[b.name] || null;
  return bones;
}

// ---------------------------------------------------------------- mesh builder
class MeshBuilder {
  constructor() { this.P = []; this.part = []; this.F = []; }
  v(p, part) { this.P.push(p.slice()); this.part.push(part); return this.P.length - 1; }
  f(a, b, c) { this.F.push([a, b, c]); }
}

// superellipse-ish anatomical profile. latP: lateral (+u) half-width,
// latN: medial (-u), fwdP: front (+v), fwdN: back (-v).
function profile(n, latP, latN, fwdP, fwdN, phase = 0, e = 2.2, bumps = null) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const ph = phase + (2 * Math.PI * k) / n;
    const sp = Math.sin(ph), cp = Math.cos(ph);
    const ex = 2 / e;
    let a = Math.sign(sp) * Math.pow(Math.abs(sp), ex) * (sp > 0 ? latP : latN);
    let b = Math.sign(cp) * Math.pow(Math.abs(cp), ex) * (cp > 0 ? fwdP : fwdN);
    if (bumps) { const m = bumps(ph); a *= m; b *= m; }
    pts.push([a, b]);
  }
  return pts;
}

// ring of vertices around center c with loft tangent t. pts are [lateral, forward]
// offsets in the ring plane. tilt shifts points along t proportional to offsets.
function ring(M, part, s, c, t, pts, tiltLat = 0, tiltFwd = 0) {
  t = norm(t);
  const u = orth([1, 0, 0], t);
  const v = orth(orth([0, 0, 1], t), u);
  return pts.map(([a, b]) => {
    let p = add(c, add(mul(u, a), mul(v, b)));
    p = add(p, mul(t, tiltLat * a + tiltFwd * b));
    return M.v(mir(p, s), part);
  });
}

function newell(M, L) {
  let n = [0, 0, 0];
  for (let i = 0; i < L.length; i++) {
    const a = M.P[L[i]], b = M.P[L[(i + 1) % L.length]];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return n;
}
function centroid(M, L) {
  let c = [0, 0, 0];
  for (const i of L) c = add(c, M.P[i]);
  return mul(c, 1 / L.length);
}

// stitch two closed loops with greedy shortest-diagonal triangulation
function bridge(M, A, B) {
  const __f0 = M.F.length;
  const nA = newell(M, A), nB = newell(M, B);
  const d = sub(centroid(M, B), centroid(M, A));
  let sA = dot(nA, d), sB = dot(nB, d);
  let same;
  if (Math.abs(sA) > 1e-7 && Math.abs(sB) > 1e-7) same = Math.sign(sA) === Math.sign(sB);
  else same = dot(nA, nB) > 0;
  if (!same) B = B.slice().reverse();
  const n = A.length, m = B.length;
  let best = Infinity, j0 = 0;
  for (let j = 0; j < m; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += dist(M.P[A[i]], M.P[B[(j + Math.round((i * m) / n)) % m]]) ** 2;
    if (sum < best) { best = sum; j0 = j; }
  }
  let i = 0, j = 0;
  while (i < n || j < m) {
    const a0 = A[i % n], a1 = A[(i + 1) % n];
    const b0 = B[(j0 + j) % m], b1 = B[(j0 + j + 1) % m];
    let advA;
    if (i >= n) advA = false;
    else if (j >= m) advA = true;
    else advA = dist(M.P[a1], M.P[b0]) < dist(M.P[a0], M.P[b1]);
    if (advA) { M.f(a0, b0, a1); i++; } else { M.f(a0, b0, b1); j++; }
  }
  if (globalThis.__log) globalThis.__log.push({A: A.slice(), B: B.slice(), j0, faces: M.F.slice(__f0)});
}

function capFan(M, L, apex, part) {
  const c = M.v(apex, part);
  for (let i = 0; i < L.length; i++) M.f(L[i], L[(i + 1) % L.length], c);
  return c;
}

// ---------------------------------------------------------------- body parts
function buildTorso(M, rnd) {
  // T ring at chest / armpit level: explicit 12 verts, k*30deg from front toward +X
  const Tl = [
    [0, 1.28, 0.102],
    [0.074, 1.285, 0.107],
    [0.13, 1.29, 0.072],
    [0.154, 1.284, -0.006],
    [0.132, 1.292, -0.074],
    [0.073, 1.29, -0.1],
    [0, 1.286, -0.088],
  ];
  const T = [];
  T[0] = M.v(Tl[0], 'torso');
  for (let k = 1; k <= 5; k++) T[k] = M.v(Tl[k], 'torso');
  T[6] = M.v(Tl[6], 'torso');
  for (let k = 1; k <= 5; k++) T[12 - k] = M.v(mir(Tl[k], -1), 'torso');

  // P ring (pelvis / buttocks), 12 verts with exact front/back centers
  const Pp = profile(12, 0.166, 0.166, 0.082, 0.108, 0, 2.3);
  const P = ring(M, 'torso', 1, [0, 0.885, -0.008], [0, 1, 0], Pp, 0, -0.08);
  // torso intermediate rings (irregular vertex counts / phases)
  const R1 = ring(M, 'torso', 1, [0, 0.965, -0.003], [0, 1, 0], profile(11, 0.156, 0.156, 0.084, 0.088, rnd() * 0.5, 2.4));
  const R2 = ring(M, 'torso', 1, [0, 1.06, -0.002], [0, 1, 0], profile(12, 0.134, 0.134, 0.083, 0.074, 0.26 + rnd() * 0.2, 2.2));
  const R3 = ring(M, 'torso', 1, [0, 1.155, 0.0], [0, 1, 0], profile(11, 0.142, 0.142, 0.092, 0.08, rnd() * 0.5, 2.3));
  const R4 = ring(M, 'torso', 1, [0, 1.225, 0.0], [0, 1, 0], profile(12, 0.152, 0.152, 0.1, 0.085, 0.15 + rnd() * 0.2, 2.4));
  bridge(M, P, R1);
  bridge(M, R1, R2);
  bridge(M, R2, R3);
  bridge(M, R3, R4);
  bridge(M, R4, T);
  return { T, P };
}

// shoulder yoke: hand-authored patch between T ring, neck loop and arm loops
function buildYoke(M, T) {
  const C = {
    Ster: M.v([0, 1.365, 0.104], 'yoke'),
    Nf: M.v([0, 1.44, 0.06], 'yoke'),
    Nb: M.v([0, 1.5, -0.07], 'yoke'),
    Sp0: M.v([0, 1.385, -0.092], 'yoke'),
  };
  const side = {};
  for (const [sfx, s] of [['L', 1], ['R', -1]]) {
    const V = (p) => M.v(mir(p, s), 'yoke');
    const Y = {
      Af: V([0.147, 1.336, 0.07]),
      Ab: V([0.143, 1.342, -0.076]),
      Sf: V([0.162, 1.39, 0.066]),
      Sb: V([0.157, 1.4, -0.076]),
      St: V([0.186, 1.44, -0.006]),
      Tr: V([0.122, 1.47, -0.022]),
      Pc: V([0.085, 1.352, 0.11]),
      Cl: V([0.094, 1.415, 0.074]),
      Sc: V([0.1, 1.412, -0.088]),
      Sp: V([0.083, 1.338, -0.106]),
      Nfl: V([0.046, 1.456, 0.046]),
      Nsl: V([0.065, 1.488, -0.012]),
      Nbl: V([0.043, 1.498, -0.06]),
    };
    const k = (i) => (s > 0 ? T[i] : T[(12 - i) % 12]);
    const T0 = k(0), T1 = k(1), T2 = k(2), T3 = k(3), T4 = k(4), T5 = k(5), T6 = k(6);
    const { Af, Ab, Sf, Sb, St, Tr, Pc, Cl, Sc, Sp, Nfl, Nsl, Nbl } = Y;
    const { Ster, Nf, Nb, Sp0 } = C;
    const tris = [
      [T0, T1, Pc], [T0, Pc, Ster], [T1, T2, Af], [T1, Af, Pc], [T2, T3, Af],
      [Ster, Pc, Cl], [Ster, Cl, Nf], [Pc, Af, Sf], [Pc, Sf, Cl], [Nf, Cl, Nfl],
      [Nfl, Cl, Nsl], [Cl, Tr, Nsl], [Cl, Sf, Tr], [Sf, St, Tr],
      [Nsl, Tr, Nbl], [Nbl, Tr, Sc], [Tr, St, Sc], [St, Sb, Sc],
      [Nb, Nbl, Sp0], [Nbl, Sc, Sp0], [Sp0, Sc, Sp], [Sc, Sb, Sp], [Sb, Ab, Sp],
      [Sp0, Sp, T5], [Sp0, T5, T6], [Sp, T4, T5], [Sp, Ab, T4], [Ab, T3, T4],
    ];
    for (const [a, b, c] of tris) M.f(a, b, c);
    side[sfx] = { armLoop: [T3, Af, Sf, St, Sb, Ab], neckHalf: [Nfl, Nsl, Nbl] };
  }
  const L = side.L.neckHalf, R = side.R.neckHalf;
  const neckLoop = [C.Nf, L[0], L[1], L[2], C.Nb, R[2], R[1], R[0]];
  return { armLoopL: side.L.armLoop, armLoopR: side.R.armLoop, neckLoop };
}

function buildArm(M, s, loop, rnd) {
  const S = J.shoulder, E = J.elbow, W = J.wrist, H = J.handTip;
  const ua = sub(E, S), fa = sub(W, E), ha = sub(H, W);
  const ph = () => rnd() * 0.8;
  const part = 'arm';
  // deltoid ring: explicit, tilted (inner point low near the armpit, cap high & outside)
  const D = [
    [0.17, 1.278, -0.008], [0.184, 1.316, 0.054], [0.196, 1.386, 0.058],
    [0.224, 1.404, -0.006], [0.194, 1.39, -0.064], [0.184, 1.316, -0.058],
  ].map((p) => M.v(mir(p, s), part));
  const U1 = ring(M, part, s, lerp3(S, E, 0.54), ua, profile(7, 0.043, 0.039, 0.046, 0.044, ph(), 2.1));
  const U2 = ring(M, part, s, lerp3(S, E, 0.72), ua, profile(6, 0.039, 0.036, 0.042, 0.038, ph(), 2.1));
  const EL = ring(M, part, s, add(E, [0, 0, -0.002]), add(norm(ua), norm(fa)), profile(6, 0.034, 0.032, 0.033, 0.039, ph(), 2.0));
  const F1 = ring(M, part, s, lerp3(E, W, 0.25), fa, profile(6, 0.039, 0.034, 0.036, 0.034, ph(), 2.1));
  const F2 = ring(M, part, s, lerp3(E, W, 0.64), fa, profile(6, 0.029, 0.027, 0.03, 0.028, ph(), 2.1));
  const WR = ring(M, part, s, W, add(norm(fa), norm(ha)), profile(6, 0.021, 0.021, 0.03, 0.028, ph(), 2.0));
  // mitten hand: flat in the lateral direction, wide front-to-back
  const H1 = ring(M, 'hand', s, add(lerp3(W, H, 0.36), [-0.002, 0, 0.002]), ha, profile(6, 0.02, 0.019, 0.048, 0.042, 0.3, 2.6));
  const H2 = ring(M, 'hand', s, add(lerp3(W, H, 0.66), [-0.007, 0, 0.002]), ha, profile(5, 0.016, 0.015, 0.042, 0.037, 0.2, 2.4));
  const H3 = ring(M, 'hand', s, add(lerp3(W, H, 0.88), [-0.014, 0, 0.0]), ha, profile(4, 0.012, 0.012, 0.032, 0.028, 0.785, 2.0));
  bridge(M, loop, D);
  bridge(M, D, U1);
  bridge(M, U1, U2);
  bridge(M, U2, EL);
  bridge(M, EL, F1);
  bridge(M, F1, F2);
  bridge(M, F2, WR);
  bridge(M, WR, H1);
  bridge(M, H1, H2);
  bridge(M, H2, H3);
  capFan(M, H3, mir(add(H, [-0.02, 0.004, -0.002]), s), 'hand');
}

function buildLeg(M, s, loop, rnd) {
  const Hp = J.hip, K = J.knee, A = J.ankle;
  const th = sub(K, Hp), sh = sub(A, K);
  const ph = () => rnd() * 0.8;
  const at = (y) => (y > K[1] ? lerp3(Hp, K, (Hp[1] - y) / (Hp[1] - K[1])) : lerp3(K, A, (K[1] - y) / (K[1] - A[1])));
  const part = 'leg';
  const L0 = ring(M, part, s, add(at(0.8), [0.004, 0, 0.004]), th, profile(8, 0.08, 0.068, 0.078, 0.084, ph(), 2.2), 0.28, 0);
  const L1 = ring(M, part, s, add(at(0.665), [0.002, 0, 0.006]), th, profile(8, 0.066, 0.058, 0.068, 0.066, ph(), 2.2));
  const L2 = ring(M, part, s, add(at(0.565), [0, 0, 0.004]), th, profile(7, 0.053, 0.052, 0.056, 0.054, ph(), 2.1));
  const L3 = ring(M, part, s, add(at(0.497), [0, 0, 0.002]), add(norm(th), norm(sh)), profile(7, 0.047, 0.047, 0.056, 0.045, ph(), 2.1));
  const L4 = ring(M, part, s, at(0.43), sh, profile(7, 0.045, 0.046, 0.046, 0.054, ph(), 2.1));
  const L5 = ring(M, part, s, add(at(0.335), [0, 0, -0.006]), sh, profile(7, 0.045, 0.05, 0.037, 0.062, ph(), 2.1));
  const L6 = ring(M, part, s, add(at(0.215), [0, 0, -0.002]), sh, profile(6, 0.034, 0.034, 0.033, 0.04, ph(), 2.0));
  const L7 = ring(M, part, s, add(at(0.105), [0, 0, 0]), sh, profile(6, 0.031, 0.03, 0.03, 0.034, ph(), 2.0));
  bridge(M, loop, L0);
  bridge(M, L0, L1);
  bridge(M, L1, L2);
  bridge(M, L2, L3);
  bridge(M, L3, L4);
  bridge(M, L4, L5);
  bridge(M, L5, L6);
  bridge(M, L6, L7);
  // foot: outline loops (horizontal) from ankle down to the sole
  const yaw = (7 * Math.PI) / 180;
  const fl = [Math.cos(yaw), 0, -Math.sin(yaw)], ff = [Math.sin(yaw), 0, Math.cos(yaw)];
  const o = [A[0], 0, A[2]];
  const F = (l, y, f) => add(o, add(mul(fl, l), add([0, y, 0], mul(ff, f))));
  const loopF = (pts) => pts.map(([l, y, f]) => M.v(mir(F(l, y, f), s), 'foot'));
  const F0 = loopF([
    [0.0, 0.066, 0.1], [0.032, 0.056, 0.06], [0.037, 0.05, -0.01], [0.022, 0.058, -0.058],
    [-0.008, 0.06, -0.064], [-0.034, 0.052, -0.03], [-0.035, 0.058, 0.05],
  ]);
  const F1 = loopF([
    [0.004, 0.022, 0.204], [0.033, 0.026, 0.172], [0.048, 0.03, 0.115], [0.043, 0.032, 0.035],
    [0.033, 0.03, -0.045], [0.004, 0.034, -0.072], [-0.03, 0.03, -0.048], [-0.037, 0.034, 0.035],
    [-0.042, 0.03, 0.125], [-0.024, 0.024, 0.2],
  ]);
  const S0 = loopF([
    [0.0, 0.0, 0.19], [0.036, 0.0, 0.12], [0.036, 0.0, 0.03], [0.024, 0.0, -0.045],
    [-0.002, 0.0, -0.062], [-0.024, 0.0, -0.042], [-0.031, 0.0, 0.035], [-0.034, 0.0, 0.125],
  ]);
  bridge(M, L7, F0);
  bridge(M, F0, F1);
  bridge(M, F1, S0);
  capFan(M, S0, mir(F(0.0, 0.0, 0.07), s), 'foot');
}

function buildHead(M, neckLoop, rnd) {
  const part = 'neck';
  const N1 = ring(M, part, 1, [0, 1.498, -0.01], [0, 1, 0.1], profile(7, 0.056, 0.056, 0.054, 0.056, rnd() * 0.8, 2.1));
  const N2 = ring(M, part, 1, [0, 1.54, -0.002], [0, 1, 0.12], profile(7, 0.053, 0.053, 0.054, 0.054, rnd() * 0.8, 2.1), 0, -0.26);
  const sym = (half) => {
    // half: list from front center (x=0) around +X to back center (x=0)
    const pts = half.slice();
    for (let i = half.length - 2; i >= 1; i--) pts.push(mir(half[i], -1));
    return pts;
  };
  const vs = (pts, p) => pts.map((q) => M.v(q, p));
  const Jw = vs(sym([[0, 1.514, 0.094], [0.039, 1.53, 0.08], [0.063, 1.572, 0.012], [0.055, 1.59, -0.062], [0, 1.585, -0.082]]), 'head');
  const Ck = vs(sym([[0, 1.632, 0.112], [0.056, 1.618, 0.091], [0.079, 1.62, 0.006], [0.065, 1.628, -0.079], [0, 1.626, -0.106]]), 'head');
  const Br = vs(sym([[0, 1.692, 0.101], [0.059, 1.69, 0.08], [0.078, 1.684, -0.006], [0.063, 1.694, -0.085], [0, 1.692, -0.103]]), 'head');
  const Cr = vs([[0.036, 1.734, 0.05], [0.055, 1.733, -0.016], [0.036, 1.736, -0.079], [-0.036, 1.736, -0.079], [-0.055, 1.733, -0.016], [-0.036, 1.734, 0.05]], 'head');
  bridge(M, neckLoop, N1);
  bridge(M, N1, N2);
  bridge(M, N2, Jw);
  bridge(M, Jw, Ck);
  bridge(M, Ck, Br);
  bridge(M, Br, Cr);
  capFan(M, Cr, [0, 1.752, -0.015], 'head');
}

// ---------------------------------------------------------------- topology utils
const ekey = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

function edgeMap(F) {
  const m = new Map();
  F.forEach((f, fi) => {
    if (!f) return;
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const key = ekey(a, b);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(fi);
    }
  });
  return m;
}

export function checkManifold(F) {
  const m = edgeMap(F);
  let bad = 0, boundary = 0;
  for (const [, fs] of m) { if (fs.length === 1) boundary++; else if (fs.length > 2) bad++; }
  return { edges: m.size, boundary, nonManifold: bad };
}

function orient(P, F) {
  const m = edgeMap(F);
  const done = new Uint8Array(F.length);
  const hasDir = (f, a, b) => (f[0] === a && f[1] === b) || (f[1] === a && f[2] === b) || (f[2] === a && f[0] === b);
  for (let seed = 0; seed < F.length; seed++) {
    if (done[seed]) continue;
    done[seed] = 1;
    const q = [seed];
    while (q.length) {
      const fi = q.pop();
      const f = F[fi];
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        for (const gi of m.get(ekey(a, b))) {
          if (gi === fi || done[gi]) continue;
          const g = F[gi];
          if (hasDir(g, a, b)) F[gi] = [g[0], g[2], g[1]];
          done[gi] = 1;
          q.push(gi);
        }
      }
    }
  }
  let vol = 0;
  for (const f of F) vol += dot(P[f[0]], cross(P[f[1]], P[f[2]]));
  if (vol < 0) for (let i = 0; i < F.length; i++) F[i] = [F[i][0], F[i][2], F[i][1]];
  return vol / 6;
}

const faceNormal = (P, f) => cross(sub(P[f[1]], P[f[0]]), sub(P[f[2]], P[f[0]]));

// ---------------------------------------------------------------- QEM merges
function planeQ(P, f) {
  const n = faceNormal(P, f);
  const area = len(n) / 2;
  const nn = norm(n);
  const d = -dot(nn, P[f[0]]);
  const p = [nn[0], nn[1], nn[2], d];
  const Q = new Float64Array(10);
  let k = 0;
  for (let i = 0; i < 4; i++) for (let j = i; j < 4; j++) Q[k++] = p[i] * p[j] * area;
  return Q;
}
function qEval(Q, v) {
  const x = v[0], y = v[1], z = v[2];
  return Q[0] * x * x + 2 * Q[1] * x * y + 2 * Q[2] * x * z + 2 * Q[3] * x + Q[4] * y * y + 2 * Q[5] * y * z + 2 * Q[6] * y + Q[7] * z * z + 2 * Q[8] * z + Q[9];
}

function decimate(P, F, part, targetFaces, rnd, lockSet) {
  const Q = P.map(() => new Float64Array(10));
  const vf = P.map(() => new Set());
  F.forEach((f, fi) => {
    const q = planeQ(P, f);
    for (const v of f) { for (let k = 0; k < 10; k++) Q[v][k] += q[k]; vf[v].add(fi); }
  });
  const alive = F.map(() => true);
  let faceCount = F.length;
  const neighbors = (v) => { const s = new Set(); for (const fi of vf[v]) for (const w of F[fi]) if (w !== v) s.add(w); return s; };
  const noise = new Map();
  let guard = 0;
  while (faceCount > targetFaces && guard++ < 5000) {
    // collect candidate edges
    let best = null, bestCost = Infinity;
    const seen = new Set();
    for (let fi = 0; fi < F.length; fi++) {
      if (!alive[fi]) continue;
      const f = F[fi];
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        const key = ekey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        if (lockSet.has(a) && lockSet.has(b)) continue;
        if (!noise.has(key)) noise.set(key, 0.35 + rnd() * 1.3);
        const Qs = new Float64Array(10);
        for (let i = 0; i < 10; i++) Qs[i] = Q[a][i] + Q[b][i];
        const cands = [];
        if (!lockSet.has(b)) cands.push([a, P[a]]);
        if (!lockSet.has(a)) cands.push([b, P[b]]);
        if (!lockSet.has(a) && !lockSet.has(b)) cands.push([-1, lerp3(P[a], P[b], 0.5)]);
        const l = dist(P[a], P[b]);
        for (const [keep, pos] of cands) {
          const c = (qEval(Qs, pos) + 2e-6 * l * l) * noise.get(key);
          if (c < bestCost) { bestCost = c; best = { a, b, keep, pos }; }
        }
      }
    }
    if (!best) break;
    const { a, b } = best;
    // validity: link condition
    const na = neighbors(a), nb = neighbors(b);
    let common = 0;
    for (const w of na) if (nb.has(w)) common++;
    const edgeFaces = [...vf[a]].filter((fi) => F[fi].includes(b));
    let ok = common === 2 && edgeFaces.length === 2;
    // normal flip / degeneracy check
    const newPos = best.pos;
    if (ok) {
      for (const v of [a, b]) {
        for (const fi of vf[v]) {
          if (edgeFaces.includes(fi)) continue;
          const f = F[fi];
          const old = norm(faceNormal(P, f));
          const pp = f.map((w) => (w === a || w === b ? newPos : P[w]));
          const nn = cross(sub(pp[1], pp[0]), sub(pp[2], pp[0]));
          if (len(nn) < 1e-7 || dot(norm(nn), old) < 0.35) { ok = false; break; }
        }
        if (!ok) break;
      }
    }
    // don't merge across parts that matter for skinning boundaries too aggressively
    if (ok && part[a] !== part[b] && rnd() < 0.7) ok = false;
    if (!ok) { noise.set(ekey(a, b), Infinity); continue; }
    // collapse b -> a at newPos
    P[a] = newPos;
    for (let k = 0; k < 10; k++) Q[a][k] += Q[b][k];
    for (const fi of edgeFaces) { alive[fi] = false; faceCount--; for (const w of F[fi]) vf[w].delete(fi); }
    for (const fi of vf[b]) { F[fi] = F[fi].map((w) => (w === b ? a : w)); vf[a].add(fi); }
    vf[b].clear();
    // reset noise of edges around a so they can be reconsidered
    for (const w of neighbors(a)) { const key = ekey(a, w); if (noise.get(key) === Infinity) noise.delete(key); }
  }
  return F.filter((_, i) => alive[i]);
}

function randomFlips(P, F, rnd, prob, maxAngleDeg) {
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  let flips = 0;
  for (let pass = 0; pass < 2; pass++) {
    const m = edgeMap(F);
    const edgeSet = new Set(m.keys());
    const touched = new Set();
    for (const [key, fs] of m) {
      if (fs.length !== 2 || rnd() > prob) continue;
      const [fi, gi] = fs;
      if (touched.has(fi) || touched.has(gi)) continue;
      const f = F[fi], g = F[gi];
      // shared edge a->b in f
      let a, b, c, d;
      for (let k = 0; k < 3; k++) {
        const x = f[k], y = f[(k + 1) % 3];
        if (ekey(x, y) === key) { a = x; b = y; c = f[(k + 2) % 3]; }
      }
      d = g.find((w) => w !== a && w !== b);
      if (edgeSet.has(ekey(c, d))) continue;
      const n1 = norm(faceNormal(P, f)), n2 = norm(faceNormal(P, g));
      if (dot(n1, n2) < cosMax) continue;
      const f2 = [a, d, c], g2 = [d, b, c];
      const m1 = faceNormal(P, f2), m2 = faceNormal(P, g2);
      const avg = norm(add(n1, n2));
      if (len(m1) < 1e-7 || len(m2) < 1e-7) continue;
      if (dot(norm(m1), avg) < 0.5 || dot(norm(m2), avg) < 0.5) continue;
      F[fi] = f2; F[gi] = g2;
      touched.add(fi); touched.add(gi);
      edgeSet.add(ekey(c, d));
      flips++;
    }
  }
  return flips;
}

// ---------------------------------------------------------------- skin weights
const ALLOWED = {
  torso: ['pelvis', 'spine1', 'spine2', 'breath', 'thighL', 'thighR'],
  yoke: ['spine2', 'neck', 'clavicleL', 'clavicleR', 'upperArmL', 'upperArmR'],
  neck: ['spine2', 'neck', 'head'],
  head: ['neck', 'head'],
  arm: ['spine2', 'clavicleL', 'clavicleR', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR'],
  hand: ['forearmL', 'forearmR', 'handL', 'handR'],
  leg: ['pelvis', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'],
  foot: ['shinL', 'shinR', 'footL', 'footR'],
};

function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return dist(p, add(a, mul(ab, t)));
}

function computeWeights(P, part, bones) {
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const skinIndex = [], skinWeight = [];
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  P.forEach((p, vi) => {
    const allowed = ALLOWED[part[vi]].filter((n) => n !== 'breath');
    const ws = [];
    for (const n of allowed) {
      const b = bones[byName.get(n)];
      // skip far-side limb bones
      if (/L$/.test(n) && p[0] < -0.01) continue;
      if (/R$/.test(n) && p[0] > 0.01) continue;
      const d = Math.max(segDist(p, b.seg[0], b.seg[1]), 0.004);
      ws.push([byName.get(n), 1 / Math.pow(d, 6)]);
    }
    ws.sort((x, y) => y[1] - x[1]);
    let top = ws.slice(0, 4);
    let sum = top.reduce((s, w) => s + w[1], 0);
    top = top.map(([i, w]) => [i, w / sum]).filter(([, w]) => w > 0.02);
    sum = top.reduce((s, w) => s + w[1], 0);
    top = top.map(([i, w]) => [i, w / sum]);
    // breathing: move part of spine2 weight on the rib cage to the breath bone
    if (part[vi] === 'torso' || part[vi] === 'yoke') {
      const f = smooth(1.12, 1.22, p[1]) * (1 - smooth(1.4, 1.47, p[1]));
      const s2 = byName.get('spine2');
      const k = top.findIndex(([i]) => i === s2);
      if (k >= 0 && f > 0 && top.length < 4) {
        const w = top[k][1] * f;
        top[k][1] -= w;
        top.push([byName.get('breath'), w]);
      }
    }
    while (top.length < 4) top.push([0, 0]);
    for (const [i, w] of top) { skinIndex.push(i); skinWeight.push(w); }
  });
  return { skinIndex, skinWeight };
}

// ---------------------------------------------------------------- main
export function generate(opts = {}) {
  const seed = opts.seed ?? 1337;
  const rnd = mulberry32(seed);
  const M = new MeshBuilder();
  const { T, P } = buildTorso(M, rnd);
  const { armLoopL, armLoopR, neckLoop } = buildYoke(M, T);
  // pants: split pelvis ring into two leg loops with crotch vertices
  const Cf = M.v([0, 0.832, 0.036], 'leg');
  const Cb = M.v([0, 0.836, -0.052], 'leg');
  const loopL = [P[0], P[1], P[2], P[3], P[4], P[5], P[6], Cb, Cf];
  const loopR = [P[6], P[7], P[8], P[9], P[10], P[11], P[0], Cf, Cb];
  buildLeg(M, 1, loopL, rnd);
  buildLeg(M, -1, loopR, rnd);
  buildArm(M, 1, armLoopL, rnd);
  buildArm(M, -1, armLoopR, rnd);
  buildHead(M, neckLoop, rnd);

  let Pp = M.P, F = M.F;
  const stats = { loftFaces: F.length };
  orient(Pp, F);
  stats.manifoldLoft = checkManifold(F);

  // irregularise
  const lock = new Set();
  // keep sole vertices exactly on the ground: lock y by preventing midpoint moves (lock all y==0 verts)
  Pp.forEach((p, i) => { if (p[1] < 1e-6) lock.add(i); });
  if (opts.decimate !== false) F = decimate(Pp, F, M.part, opts.targetFaces ?? Math.round(F.length * 0.84), rnd, lock);
  stats.flips = randomFlips(Pp, F, rnd, opts.flipProb ?? 0.18, 22);
  // jitter (seeded), keep ground contact exact
  const jit = opts.jitter ?? 0.0035;
  Pp = Pp.map((p) => {
    if (p[1] < 1e-6) return [p[0] + (rnd() - 0.5) * jit, 0, p[2] + (rnd() - 0.5) * jit];
    return [p[0] + (rnd() - 0.5) * 2 * jit, p[1] + (rnd() - 0.5) * 2 * jit * 1.4, p[2] + (rnd() - 0.5) * 2 * jit];
  });
  orient(Pp, F);
  stats.manifoldFinal = checkManifold(F);

  // compact vertices
  const used = new Map();
  const outP = [], outPart = [];
  const outF = F.map((f) => f.map((v) => {
    if (!used.has(v)) { used.set(v, outP.length); outP.push(Pp[v]); outPart.push(M.part[v]); }
    return used.get(v);
  }));
  const bones = buildBones();
  const { skinIndex, skinWeight } = computeWeights(outP, outPart, bones);
  // per-face tint (albedo variation)
  const faceTint = outF.map(() => +(0.9 + rnd() * 0.2).toFixed(3));
  stats.vertices = outP.length;
  stats.faces = outF.length;
  return {
    positions: outP.flat().map((x) => +x.toFixed(4)),
    indices: outF.flat(),
    skinIndex,
    skinWeight: skinWeight.map((w) => +w.toFixed(4)),
    faceTint,
    bones: bones.map((b) => ({ name: b.name, parent: b.parent, pos: b.head.map((x) => +x.toFixed(4)) })),
    stats,
  };
}
