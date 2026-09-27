// Hand-authored landmark data for the low-poly mannequin ("sculpted").
// Units: meters. +Y up, +Z forward (the figure faces +Z), +X = the figure's LEFT.
// Only the left half (x >= 0) is authored; the builder mirrors it.
//
// Weight keys: hips, spine, chest, neck, head, clav, uarm, farm, hand, thigh, shin, foot.
// Side-specific keys (clav..foot) resolve to _L / _R in the builder.

// ---------------------------------------------------------------- skeleton
export const HEIGHT = 1.75; // final standing height (the data is authored a touch taller)
export const JOINTS = {
  hips: [0, 0.97, -0.005],
  spine: [0, 1.07, -0.015],
  chest: [0, 1.22, -0.015],
  neck: [0, 1.455, -0.02],
  head: [0, 1.555, -0.005],
  clav: [0.025, 1.43, -0.01],
  uarm: [0.176, 1.4, -0.012],
  farm: [0.242, 1.118, -0.04],
  hand: [0.276, 0.882, -0.004],
  handEnd: [0.291, 0.707, 0.014],
  thigh: [0.086, 0.915, 0.0],
  shin: [0.097, 0.49, 0.03],
  foot: [0.11, 0.075, -0.012],
};

// ---------------------------------------------------------------- torso
// Half rings from the front to the back around the left side. Points on x = 0 are
// shared centre-line vertices; rings without them are mirrored pairs (this breaks
// up the centre seam the way a decimated scan would).
// Point: [x, y, z, weightOverride?]. Ring weights apply when no override is given.
// jy: seeded vertical scatter (m) so the loops do not read as horizontal bands.
export const TORSO = {
  // leg split: F, a1..a5, B  (+ crotch vertex below). Also the top loop of each leg.
  P0: {
    w: { hips: 1 },
    pts: [
      [0, 0.866, 0.078],
      [0.066, 0.874, 0.09, { hips: 0.75, thigh: 0.25 }],
      [0.132, 0.915, 0.068, { hips: 0.6, thigh: 0.4 }],
      [0.158, 0.882, -0.012, { hips: 0.5, thigh: 0.5 }],
      [0.14, 0.85, -0.088, { hips: 0.55, thigh: 0.45 }],
      [0.072, 0.832, -0.108, { hips: 0.6, thigh: 0.4 }],
      [0, 0.846, -0.084],
    ],
  },
  CROTCH: [0, 0.808, -0.004],
  // hips / iliac crest
  P1: {
    jy: 0.012,
    w: { hips: 1 },
    pts: [
      [0, 0.952, 0.094],
      [0.134, 0.978, 0.066],
      [0.159, 0.945, -0.01, { hips: 0.8, thigh: 0.2 }],
      [0.141, 0.935, -0.088],
      [0.076, 0.925, -0.12],
      [0, 0.93, -0.099],
    ],
  },
  // waist
  W: {
    jy: 0.014,
    w: { hips: 0.3, spine: 0.7 },
    pts: [
      [0.052, 1.078, 0.093],
      [0.127, 1.08, 0.022],
      [0.113, 1.071, -0.062],
      [0.045, 1.07, -0.085],
    ],
  },
  // chest / lower pecs / lats
  C: {
    jy: 0.01,
    w: { chest: 0.8, spine: 0.2 },
    pts: [
      [0.052, 1.236, 0.126],
      [0.13, 1.238, 0.084],
      [0.164, 1.244, -0.012],
      [0.13, 1.244, -0.09],
      [0.046, 1.244, -0.104],
    ],
  },
  // armpit ring: A0, FAF, AX, PAF, A6   (FAF/AX/PAF bound the arm hole)
  A: {
    w: { chest: 1 },
    pts: [
      [0, 1.345, 0.112],
      [0.131, 1.326, 0.09, { chest: 0.7, uarm: 0.3 }],
      [0.153, 1.302, -0.006, { chest: 0.55, uarm: 0.45 }],
      [0.138, 1.326, -0.084, { chest: 0.7, uarm: 0.3 }],
      [0, 1.345, -0.101],
    ],
  },
  // shoulder line: S0 (sternal notch), S1 (clavicle), AF, AT, AB (acromion), S5, S6
  S: {
    w: { chest: 0.8, neck: 0.2 },
    pts: [
      [0, 1.425, 0.076],
      [0.085, 1.428, 0.084, { chest: 0.6, clav: 0.4 }],
      [0.174, 1.414, 0.045, { clav: 0.45, uarm: 0.55 }],
      [0.196, 1.426, -0.012, { clav: 0.4, uarm: 0.6 }],
      [0.172, 1.418, -0.068, { clav: 0.45, uarm: 0.55 }],
      [0.09, 1.446, -0.09, { chest: 0.6, clav: 0.4 }],
      [0, 1.436, -0.088],
    ],
  },
};
export const TORSO_ORDER = ['P0', 'P1', 'W', 'C', 'A', 'S'];
// indices (into the half rings) of the vertices that bound each arm hole
export const ARMHOLE = { A: { faf: 1, ax: 2, paf: 3 }, S: { af: 2, at: 3, ab: 4 } };

// ---------------------------------------------------------------- neck + head
export const HEAD = [
  {
    // N0 neck base (sits into the trapezius)
    w: { neck: 0.55, chest: 0.45 },
    pts: [
      [0.034, 1.462, 0.056],
      [0.072, 1.498, -0.012],
      [0.036, 1.506, -0.066],
    ],
  },
  {
    // N1 upper neck
    w: { neck: 0.75, head: 0.25 },
    pts: [
      [0, 1.508, 0.052],
      [0.052, 1.52, 0.024],
      [0.056, 1.535, -0.036],
      [0, 1.548, -0.062],
    ],
  },
  {
    // H0 under jaw -> occiput base (tilted)
    w: { head: 0.75, neck: 0.25 },
    pts: [
      [0, 1.534, 0.054],
      [0.066, 1.574, 0.012],
      [0.063, 1.598, -0.062],
      [0, 1.6, -0.086],
    ],
  },
  {
    // H1 chin / jaw line
    w: { head: 1 },
    pts: [
      [0, 1.553, 0.099],
      [0.064, 1.584, 0.062],
      [0.085, 1.614, -0.018],
      [0.064, 1.625, -0.092],
      [0, 1.632, -0.113],
    ],
  },
  {
    // H2 cheekbone / temple
    w: { head: 1 },
    pts: [
      [0, 1.666, 0.115],
      [0.075, 1.672, 0.074],
      [0.096, 1.683, -0.022],
      [0.069, 1.692, -0.101],
      [0, 1.694, -0.122],
    ],
  },
  {
    // H3 forehead / crown ring
    w: { head: 1 },
    pts: [
      [0.04, 1.738, 0.09],
      [0.079, 1.742, -0.012],
      [0.038, 1.75, -0.104],
    ],
  },
];
export const HEAD_TOP = [0, 1.786, -0.01];

// ---------------------------------------------------------------- arm (left)
// Deltoid cap ring, explicit (world coords), ordered front -> out -> back -> in.
export const DELTOID = {
  w: { uarm: 0.8, clav: 0.2 },
  pts: [
    [0.205, 1.342, 0.058],
    [0.237, 1.366, 0.01],
    [0.234, 1.354, -0.052],
    [0.195, 1.326, -0.08],
    [0.172, 1.29, -0.052],
    [0.168, 1.266, -0.006],
    [0.185, 1.302, 0.055],
  ],
};
// Rings on bone segments: [segment, t, [[phiDeg, radius, alongAxis?], ...], centreOffset?, scatter?]
// phi: 0 = front (+Z), 90 = lateral (out), 180 = back, 270 = medial (in).
// centreOffset: [out, fwd] metres. scatter: seeded along-axis jitter amplitude (m).
export const ARM = [
  ['uarm', 0.46, [[0, 0.052], [70, 0.055, 0.014], [145, 0.053, 0.008], [220, 0.048], [292, 0.047]], null, 0.014],
  ['uarm', 0.98, [[8, 0.043], [85, 0.044], [165, 0.043, -0.004], [240, 0.041], [310, 0.042]]],
  ['farm', 0.3, [[0, 0.048], [55, 0.052], [120, 0.046], [182, 0.043], [242, 0.041], [300, 0.046]], null, 0.014],
  ['farm', 0.97, [[0, 0.031], [75, 0.023], [165, 0.03], [240, 0.021], [305, 0.022]]],
  ['hand', 0.4, [[0, 0.052], [80, 0.031], [175, 0.047], [250, 0.029], [312, 0.038]], [0, 0.002]],
  ['hand', 1.0, [[8, 0.034], [95, 0.016], [175, 0.031], [265, 0.016]], [-0.012, 0.0]], // squared mitten tip
];
// palm faces the thigh, turned slightly backward (degrees about the hand axis)
export const HAND_TWIST = 28;

// ---------------------------------------------------------------- leg (left)
export const LEG = [
  ['thigh', 0.42, [[0, 0.085], [60, 0.078], [120, 0.074], [180, 0.078], [245, 0.07], [305, 0.077]], null, 0.02],
  ['thigh', 1.0, [[0, 0.056], [60, 0.052], [120, 0.051], [180, 0.051], [240, 0.053], [300, 0.055]]],
  ['shin', 0.3, [[0, 0.048], [55, 0.054], [105, 0.059], [155, 0.066], [205, 0.068], [258, 0.062], [310, 0.05]], null, 0.014],
  ['shin', 0.68, [[0, 0.037], [72, 0.039], [142, 0.042], [205, 0.043], [270, 0.039], [322, 0.037]], null, 0.02],
];
// ankle ring + foot rings, relative to the ankle joint in x/z, absolute y (sole at y = 0).
// Foot-local frame: x lateral, z toward the toes. Rotated by TOE_OUT about Y.
export const TOE_OUT = 7; // degrees
export const FOOT = [
  {
    // ankle (malleoli)
    w: { shin: 0.4, foot: 0.6 },
    pts: [[0, 0.086, 0.03], [0.035, 0.078, 0.006], [0.03, 0.084, -0.031], [0, 0.09, -0.038], [-0.03, 0.086, -0.031], [-0.036, 0.087, 0.006]],
  },
  {
    // heel / instep ring (tilted)
    w: { foot: 1 },
    pts: [[0, 0.078, 0.054], [0.043, 0.046, 0.03], [0.036, 0.008, -0.05], [0, 0, -0.068], [-0.035, 0.009, -0.05], [-0.042, 0.05, 0.03]],
  },
  {
    // ball of foot (vertical ring)
    w: { foot: 1 },
    pts: [[-0.004, 0.05, 0.118], [0.046, 0.028, 0.108], [0.036, 0, 0.098], [-0.002, 0, 0.11], [-0.042, 0, 0.122], [-0.051, 0.034, 0.122]],
  },
  {
    // toes (blunt)
    w: { foot: 1 },
    pts: [[-0.01, 0.032, 0.17], [0.033, 0.014, 0.155], [0, 0, 0.172], [-0.038, 0, 0.178], [-0.046, 0.024, 0.174]],
  },
];
// toe cap apex: offset from the centroid of the last foot ring (foot-local)
export const TOE_TIP = [0.0, -0.002, 0.012];
