// Low-poly faceted mannequin ("decimated scan" look) with a subtle idle.
//
// Geometry is baked offline by bake.mjs (SDF sculpt -> surface nets -> QEM
// decimation) into data.js. At runtime we only unpack it into a non-indexed
// SkinnedMesh (one colour + barycentric coords per facet so the dark edge lines
// are drawn in the fragment shader and follow the skinning), build the bone
// hierarchy and pose it procedurally as a pure function of time.
import * as THREE from 'three';
import { BONES, POS, IDX, SKIN_I, SKIN_W, POS_SCALE, JOINTS } from './data.js';

// ----------------------------------------------------------------- helpers
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG = Math.PI / 180;

// ----------------------------------------------------------------- geometry
const FACET_DARK = new THREE.Color(0x77746e);
const FACET_LIGHT = new THREE.Color(0xa29f97);
const FACET_HIGHLIGHT = new THREE.Color(0xe9e7e1);

function buildGeometry() {
  const triCount = IDX.length / 3;
  const n = triCount * 3;
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const bary = new Float32Array(n * 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const rand = mulberry32(0x5eed1e);
  const c = new THREE.Color();

  for (let f = 0; f < triCount; f++) {
    // per-facet tone: mostly mid greys, a few darker and a few bright facets
    const r = rand();
    const tone = Math.pow(rand(), 0.9);
    c.copy(FACET_DARK).lerp(FACET_LIGHT, tone);
    if (r > 0.97) c.lerp(FACET_HIGHLIGHT, 0.45);
    const warm = (rand() - 0.5) * 0.05; // slight warm/cool drift per facet
    for (let k = 0; k < 3; k++) {
      const v = IDX[f * 3 + k];
      const o = f * 3 + k;
      position[o * 3] = POS[v * 3] / POS_SCALE;
      position[o * 3 + 1] = POS[v * 3 + 1] / POS_SCALE;
      position[o * 3 + 2] = POS[v * 3 + 2] / POS_SCALE;
      color[o * 3] = c.r + warm;
      color[o * 3 + 1] = c.g + warm * 0.5;
      color[o * 3 + 2] = c.b - warm * 0.4;
      bary[o * 3 + k] = 1;
      for (let j = 0; j < 4; j++) {
        skinIndex[o * 4 + j] = SKIN_I[v * 4 + j];
        skinWeight[o * 4 + j] = SKIN_W[v * 4 + j] / 255;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('barycentric', new THREE.BufferAttribute(bary, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ----------------------------------------------------------------- material
// Matte flat-shaded Lambert + screen-space facet outlines from barycentrics.
function buildMaterial({ edgeColor, edgeOpacity, baseColor }) {
  const material = new THREE.MeshLambertMaterial({
    color: baseColor !== undefined ? baseColor : 0xffffff,
    vertexColors: true,
    flatShading: true,
  });
  const uniforms = {
    uEdgeColor: { value: new THREE.Color(edgeColor) },
    uEdgeOpacity: { value: edgeOpacity },
    uEdgeWidth: { value: 0.6 },
    uLift: { value: 0.22 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 barycentric;\nvarying vec3 vBary;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBary = barycentric;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBary;\nuniform vec3 uEdgeColor;\nuniform float uEdgeOpacity;\nuniform float uEdgeWidth;\nuniform float uLift;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uLift;',
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          vec3 fw = fwidth(vBary);
          vec3 px = vBary / max(fw, vec3(1e-6));
          float m = min(min(px.x, px.y), px.z);
          float edge = 1.0 - smoothstep(uEdgeWidth - 0.5, uEdgeWidth + 0.5, m);
          // facets smaller than a few pixels (figure far away): soften the lines
          float fmax = max(max(fw.x, fw.y), fw.z);
          edge *= mix(1.0, 0.4, smoothstep(0.05, 0.22, fmax));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, edge * uEdgeOpacity);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'sdf-decimate-facet-edges';
  return material;
}

// ----------------------------------------------------------------- rig
function buildSkeleton() {
  const bones = BONES.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  BONES.forEach((b, i) => {
    if (b.parent >= 0) {
      const p = BONES[b.parent].pos;
      bones[i].position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
      bones[b.parent].add(bones[i]);
    } else {
      bones[i].position.set(b.pos[0], b.pos[1], b.pos[2]);
    }
  });
  const byName = {};
  bones.forEach((b) => { byName[b.name] = b; });
  return { bones, byName };
}

// Analytic two-bone leg IK that keeps the ankle (and the foot's world
// orientation) exactly at the rest pose, whatever the pelvis does.
function createLegSolver(side) {
  const s = side === 'L' ? 1 : -1;
  const hip = new THREE.Vector3(JOINTS.hip[0] * s, JOINTS.hip[1], JOINTS.hip[2]);
  const knee = new THREE.Vector3(JOINTS.knee[0] * s, JOINTS.knee[1], JOINTS.knee[2]);
  const ankle = new THREE.Vector3(JOINTS.ankle[0] * s, JOINTS.ankle[1], JOINTS.ankle[2]);
  const L1 = hip.distanceTo(knee);
  const L2 = knee.distanceTo(ankle);
  const restReach = hip.distanceTo(ankle);
  // bend direction of the rest knee (perpendicular to the hip->ankle line)
  const u0 = ankle.clone().sub(hip).normalize();
  const pole = knee.clone().sub(hip);
  pole.sub(u0.clone().multiplyScalar(pole.dot(u0))).normalize();
  // rest frames of thigh and shin
  const restThigh = frameQuat(knee.clone().sub(hip), pole, new THREE.Quaternion());
  const restShin = frameQuat(ankle.clone().sub(knee), pole, new THREE.Quaternion());
  const restThighInv = restThigh.clone().invert();
  const restShinInv = restShin.clone().invert();

  const _u = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _k = new THREE.Vector3();
  const _d = new THREE.Vector3();
  return {
    hipRest: hip,
    ankle,
    restReach,
    // hipWorld: current hip joint; outputs world quats of thigh and shin
    solve(hipWorld, outThigh, outShin) {
      _u.copy(ankle).sub(hipWorld);
      let d = _u.length();
      _u.divideScalar(d);
      d = Math.min(d, L1 + L2 - 1e-5);
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      _n.copy(pole).addScaledVector(_u, -pole.dot(_u)).normalize();
      _k.copy(hipWorld).addScaledVector(_u, a).addScaledVector(_n, h);
      _d.copy(_k).sub(hipWorld); // hip -> knee
      frameQuat(_d, _n, outThigh).multiply(restThighInv);
      _d.copy(hipWorld).addScaledVector(_u, d).sub(_k); // knee -> ankle
      frameQuat(_d, _n, outShin).multiply(restShinInv);
      return _k;
    },
  };
}

const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _fm = new THREE.Matrix4();
function frameQuat(dir, bend, out) {
  _fx.copy(dir).normalize();
  _fy.copy(bend).addScaledVector(_fx, -bend.dot(_fx)).normalize();
  _fz.crossVectors(_fx, _fy);
  _fm.makeBasis(_fx, _fy, _fz);
  return out.setFromRotationMatrix(_fm);
}

// ----------------------------------------------------------------- figure
export function createFigure(options = {}) {
  const { edgeColor = 0x1a1a1a, edgeOpacity = 1, baseColor } = options;
  const geometry = buildGeometry();
  const material = buildMaterial({ edgeColor, edgeOpacity, baseColor });
  const { bones, byName } = buildSkeleton();

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'figure';
  mesh.frustumCulled = false;
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));

  const object = new THREE.Group();
  object.name = 'faceted-figure';
  object.add(mesh);

  const pose = createIdle(byName);
  pose(0);

  return {
    object,
    update(t) { pose(t); },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.skeleton.dispose();
    },
  };
}

// ----------------------------------------------------------------- idle
// Everything below is a pure function of t (seconds). Periods are mutually
// incommensurate so the idle never visibly loops.
const TAU = Math.PI * 2;
const wave = (t, period, phase = 0) => Math.sin((t / period) * TAU + phase);

// lateral weight shift of the pelvis (m), positive = towards the figure's left (+X)
const weightShift = (t) => 0.019 * wave(t, 10.5) + 0.004 * wave(t, 6.3, 1.3);
// 0..1 breathing cycle (inhale ~ first half)
const breathing = (t) => 0.5 - 0.5 * Math.cos((t / 4.6) * TAU);

function createIdle(b) {
  const legL = createLegSolver('L');
  const legR = createLegSolver('R');
  const pelvisRest = b.pelvis.position.clone();
  const hipOffL = b.thighL.position.clone();
  const hipOffR = b.thighR.position.clone();
  const breathRest = b.breath.position.clone();

  const qPelvis = new THREE.Quaternion();
  const qThighW = new THREE.Quaternion();
  const qShinW = new THREE.Quaternion();
  const qInv = new THREE.Quaternion();
  const e = new THREE.Euler();
  const hipW = new THREE.Vector3();
  const pelvisPos = new THREE.Vector3();

  const setRot = (bone, x, y, z) => bone.quaternion.setFromEuler(e.set(x, y, z, 'YXZ'));
  const hipWorld = (out, off) => out.copy(off).applyQuaternion(qPelvis).add(pelvisPos);

  function solveLeg(leg, thigh, shin, foot, hipOff) {
    leg.solve(hipWorld(hipW, hipOff), qThighW, qShinW);
    thigh.quaternion.copy(qInv.copy(qPelvis).invert()).multiply(qThighW);
    shin.quaternion.copy(qInv.copy(qThighW).invert()).multiply(qShinW);
    foot.quaternion.copy(qShinW).invert(); // foot keeps its rest orientation in world
  }
  // how far the pelvis must drop so this leg can still reach its planted ankle
  function dropFor(leg, hipOff) {
    hipWorld(hipW, hipOff);
    const dx = leg.ankle.x - hipW.x, dz = leg.ankle.z - hipW.z;
    const vert = Math.sqrt(Math.max(0, leg.restReach * leg.restReach - dx * dx - dz * dz));
    return Math.min(0, leg.ankle.y + vert - hipW.y);
  }

  return function pose(t) {
    const shift = weightShift(t);
    const breath = breathing(t);
    const sway = 0.005 * wave(t, 8.1, 0.7); // slow fore/aft sway (m)

    // --- pelvis: shifts over the loaded leg, loaded hip rises a little ---
    const roll = shift * 1.3; // ~1.8 deg at full shift
    const yaw = 0.8 * DEG * wave(t, 10.5, -0.8);
    const tilt = 0.4 * DEG * wave(t, 8.1, 2.0);
    qPelvis.setFromEuler(e.set(tilt, yaw, roll, 'YXZ'));
    pelvisPos.set(pelvisRest.x + shift, pelvisRest.y, pelvisRest.z + sway);
    pelvisPos.y += Math.min(dropFor(legL, hipOffL), dropFor(legR, hipOffR)) - 0.0008;
    b.pelvis.position.copy(pelvisPos);
    b.pelvis.quaternion.copy(qPelvis);

    // --- legs: analytic IK, ankles and feet stay exactly planted ---
    solveLeg(legL, b.thighL, b.shinL, b.footL, hipOffL);
    solveLeg(legR, b.thighR, b.shinR, b.footR, hipOffR);

    // --- spine: counter the pelvis so shoulders stay near level and the
    //     head travels well under half as far as the hips ---
    const lean = -sway * 0.8; // lean back when the pelvis drifts forward
    setRot(b.spine1, lean * 0.5 + 0.3 * DEG * breath, -yaw * 0.5, -shift * 0.15);
    setRot(b.spine2, lean * 0.5 - 0.8 * DEG * breath, -yaw * 0.4, -shift * 0.95);
    b.breath.scale.set(1 + 0.016 * breath, 1 + 0.008 * breath, 1 + 0.024 * breath);
    b.breath.position.set(breathRest.x, breathRest.y + 0.002 * breath, breathRest.z);

    // --- neck / head: slow, non-repeating drift; keeps the gaze level ---
    const hy = 2.4 * DEG * wave(t, 13.3, 0.4) + 1.1 * DEG * wave(t, 7.1, 2.2);
    const hp = 1.4 * DEG * wave(t, 9.7, 1.1) + 0.6 * DEG * wave(t, 5.3) + 0.5 * DEG * breath;
    const hr = -shift * 0.2 + 0.7 * DEG * wave(t, 11.9, 0.3);
    setRot(b.neck, hp * 0.4, hy * 0.4 + yaw * 0.3, hr * 0.4);
    setRot(b.head, hp * 0.6, hy * 0.6, hr * 0.6);

    // --- shoulders lift a few mm with each breath ---
    const lift = 1.2 * DEG * breath;
    setRot(b.clavicleL, 0, 0, lift);
    setRot(b.clavicleR, 0, 0, -lift);

    // --- arms: hang with gravity (undo chest tilt, slightly lagged) plus a
    //     tiny independent pendulum sway ---
    const chestTiltLag = weightShift(t - 0.7) * (1.3 - 0.15 - 0.95);
    const hangL = -chestTiltLag - lift * 0.85 + 0.5 * DEG * wave(t, 5.4);
    const hangR = -chestTiltLag + lift * 0.85 - 0.5 * DEG * wave(t, 5.9, 1.0);
    setRot(b.upperArmL, 0.6 * DEG * wave(t, 6.1, 0.5), 0, hangL);
    setRot(b.upperArmR, 0.6 * DEG * wave(t, 6.7, 2.1), 0, hangR);
    setRot(b.forearmL, 0.8 * DEG * wave(t, 6.1, -0.3), 0, 0);
    setRot(b.forearmR, 0.8 * DEG * wave(t, 6.7, 1.3), 0, 0);
    setRot(b.handL, 1.2 * DEG * wave(t, 6.1, -1.0), 0, 0.6 * DEG * wave(t, 4.9));
    setRot(b.handR, 1.2 * DEG * wave(t, 6.7, 0.6), 0, -0.6 * DEG * wave(t, 5.2));
  };
}
