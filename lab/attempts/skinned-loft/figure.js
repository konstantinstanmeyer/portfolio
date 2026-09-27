// Low-poly faceted human mannequin — "skinned-loft" technique.
// One continuous lofted surface (baked into data.js by bake.mjs / generate.js),
// rigged with a THREE.Skeleton and animated procedurally (idle breathing,
// weight shift with 2-bone leg IK so the feet stay planted, head drift, arm sway).
// Triangle edges are drawn in the fragment shader from barycentric coordinates,
// so the outlines follow the skinned surface exactly.
import * as THREE from 'three';
import { FIGURE_DATA } from './data.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function buildGeometry(data, baseColor) {
  const { positions: P, indices: I, skinIndex: SI, skinWeight: SW, faceTint } = data;
  const nF = I.length / 3;
  const pos = new Float32Array(nF * 9);
  const col = new Float32Array(nF * 9);
  const bar = new Float32Array(nF * 9);
  const sIdx = new Uint16Array(nF * 12);
  const sWgt = new Float32Array(nF * 12);
  const c = new THREE.Color();
  const light = new THREE.Color(0xd9d5ca);
  for (let f = 0; f < nF; f++) {
    const tint = faceTint[f];
    c.copy(baseColor).multiplyScalar(Math.min(tint, 1.0));
    if (tint > 1) c.lerp(light, (tint - 1) * 1.2);
    for (let k = 0; k < 3; k++) {
      const v = I[f * 3 + k];
      const o = (f * 3 + k) * 3;
      pos[o] = P[v * 3]; pos[o + 1] = P[v * 3 + 1]; pos[o + 2] = P[v * 3 + 2];
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      bar[o + k] = 1;
      for (let j = 0; j < 4; j++) {
        sIdx[(f * 3 + k) * 4 + j] = SI[v * 4 + j];
        sWgt[(f * 3 + k) * 4 + j] = SW[v * 4 + j];
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('bary', new THREE.BufferAttribute(bar, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sWgt, 4));
  return g;
}

function buildMaterial(edgeColor, edgeOpacity, emissiveFloor) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0.0,
  });
  // small emissive floor so faces turned fully away from every light never go pure black
  mat.emissive.copy(emissiveFloor);
  const uniforms = {
    uEdgeColor: { value: new THREE.Color(edgeColor) },
    uEdgeOpacity: { value: edgeOpacity },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bary;\nvarying vec3 vBary;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBary = bary;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEdgeColor;\nuniform float uEdgeOpacity;\nvarying vec3 vBary;')
      .replace(
        '#include <tonemapping_fragment>',
        `{
          vec3 fw = fwidth(vBary);
          vec3 e3 = smoothstep(fw * 0.35, fw * 1.25, vBary);
          float edge = 1.0 - min(min(e3.x, e3.y), e3.z);
          // fade lines on triangles that are only a few pixels wide (keeps tiny figures readable)
          float px = 1.0 / max(max(fw.x, fw.y), fw.z);
          edge *= mix(0.35, 1.0, smoothstep(3.0, 14.0, px));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, edge * uEdgeOpacity);
        }
        #include <tonemapping_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'skinned-loft-bary-edges';
  return { mat, uniforms };
}

export function createFigure(options = {}) {
  const data = FIGURE_DATA;
  const edgeColor = options.edgeColor ?? 0x1a1a1a;
  const edgeOpacity = options.edgeOpacity ?? 1;
  const baseColor = new THREE.Color(options.baseColor ?? 0xb3afa4);

  const object = new THREE.Group();
  object.name = 'skinned-loft-figure';

  // --- skeleton (bind pose: identity rotations, translations only)
  const bones = data.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  data.bones.forEach((b, i) => {
    if (b.parent < 0) {
      bones[i].position.fromArray(b.pos);
    } else {
      const p = data.bones[b.parent].pos;
      bones[i].position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
      bones[b.parent].add(bones[i]);
    }
  });
  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const root = B.pelvis;
  object.add(root);
  object.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const geometry = buildGeometry(data, baseColor);
  const { mat: material } = buildMaterial(edgeColor, edgeOpacity, baseColor.clone().multiplyScalar(0.07));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'skinned-loft-mesh';
  mesh.frustumCulled = false;
  object.add(mesh);
  mesh.bind(skeleton);

  // --- bind-pose constants for animation / IK
  const bindPos = (name) => new THREE.Vector3().fromArray(data.bones.find((b) => b.name === name).pos);
  const pelvisBind = root.position.clone();
  const legs = ['L', 'R'].map((s) => {
    const H0 = bindPos('thigh' + s), K0 = bindPos('shin' + s), A0 = bindPos('foot' + s);
    return {
      thigh: B['thigh' + s], shin: B['shin' + s], foot: B['foot' + s],
      hipOffset: B['thigh' + s].position.clone(),
      ankle: A0,
      L1: K0.distanceTo(H0), L2: A0.distanceTo(K0),
      thighDir: K0.clone().sub(H0).normalize(),
      shinDir: A0.clone().sub(K0).normalize(),
    };
  });

  // temporaries (no per-frame allocation)
  const e = new THREE.Euler();
  const qPel = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  const qS = new THREE.Quaternion();
  const qInv = new THREE.Quaternion();
  const vH = new THREE.Vector3(), vD = new THREE.Vector3(), vK = new THREE.Vector3();
  const vPole = new THREE.Vector3(), vTmp = new THREE.Vector3();

  const setRot = (bone, x, y, z) => { e.set(x, y, z, 'XYZ'); bone.quaternion.setFromEuler(e); };

  function solveLeg(leg, poleX, poleZ) {
    // hip in figure space
    vH.copy(leg.hipOffset).applyQuaternion(qPel).add(root.position);
    vD.copy(leg.ankle).sub(vH);
    let d = vD.length();
    vD.divideScalar(d);
    const maxD = (leg.L1 + leg.L2) * 0.99995;
    d = Math.min(Math.max(d, Math.abs(leg.L1 - leg.L2) + 1e-4), maxD);
    const a = (leg.L1 * leg.L1 - leg.L2 * leg.L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, leg.L1 * leg.L1 - a * a));
    vPole.set(poleX, 0, poleZ);
    vPole.addScaledVector(vD, -vPole.dot(vD)).normalize();
    vK.copy(vH).addScaledVector(vD, a).addScaledVector(vPole, h);
    // thigh world rotation
    vTmp.copy(vK).sub(vH).normalize();
    qT.setFromUnitVectors(leg.thighDir, vTmp);
    // shin world rotation (ankle stays at the bind ankle)
    vTmp.copy(leg.ankle).sub(vK).normalize();
    qS.setFromUnitVectors(leg.shinDir, vTmp);
    // to local
    qInv.copy(qPel).invert();
    leg.thigh.quaternion.copy(qInv).multiply(qT);
    qInv.copy(qT).invert();
    leg.shin.quaternion.copy(qInv).multiply(qS);
    leg.foot.quaternion.copy(qS).invert(); // world identity -> planted
  }

  function update(t) {
    // ---- signals (pure functions of absolute time)
    const breath = Math.sin((TAU * t) / 4.7); // -1..1, ~4.7 s
    const inhale = 0.5 + 0.5 * breath;
    const shift = 0.82 * Math.sin((TAU * t) / 10.6) + 0.18 * Math.sin((TAU * t) / 6.1 + 1.3);
    const shiftLag = 0.82 * Math.sin((TAU * (t - 0.9)) / 10.6) + 0.18 * Math.sin((TAU * (t - 0.9)) / 6.1 + 1.3);
    const drift1 = Math.sin((TAU * t) / 13.7 + 0.4);
    const drift2 = Math.sin((TAU * t) / 8.3 + 2.1);
    const drift3 = Math.sin((TAU * t) / 17.9 + 4.2);

    // ---- pelvis: lateral weight shift + roll (loaded hip rises) + slight yaw
    const roll = 1.5 * DEG * shift;
    const yaw = 0.9 * DEG * drift3;
    root.position.set(
      pelvisBind.x + 0.019 * shift,
      pelvisBind.y - 0.0035 - 0.0025 * shift * shift,
      pelvisBind.z + 0.003 * drift1
    );
    setRot(root, 0.2 * DEG * drift2, yaw, roll);
    qPel.copy(root.quaternion);

    // ---- spine counter-rotation (keeps head over the feet), breathing
    setRot(B.spine1, -0.15 * DEG * breath, -0.4 * yaw, -0.55 * roll);
    setRot(B.spine2, -0.35 * DEG * breath, -0.35 * yaw, -0.5 * roll);
    B.breath.scale.setScalar(1 + 0.014 * inhale);
    // ---- neck / head drift (incommensurate periods)
    setRot(B.neck, 0.2 * DEG * breath + 0.5 * DEG * drift2, 0.2 * yaw, -0.25 * roll);
    setRot(
      B.head,
      1.3 * DEG * Math.sin((TAU * t) / 9.7 + 0.8) + 0.6 * DEG * drift3,
      3.0 * DEG * (0.65 * drift1 + 0.35 * Math.sin((TAU * t) / 5.9 + 1.0)),
      0.8 * DEG * Math.sin((TAU * t) / 12.3 + 2.6) - 0.2 * roll
    );
    // ---- shoulders lift on inhale, arms hang (counter the chest roll) with lagging sway
    const lift = 0.7 * DEG * inhale;
    setRot(B.clavicleL, 0, 0, lift);
    setRot(B.clavicleR, 0, 0, -lift);
    const chestRoll = roll * (1 - 0.55 - 0.5);
    const swayZ = -chestRoll - 1.2 * DEG * (shiftLag - shift) * 2.0;
    const swayX = 1.2 * DEG * Math.sin((TAU * (t - 0.6)) / 7.3) + 0.4 * DEG * breath;
    setRot(B.upperArmL, swayX, 0.5 * DEG * drift1, swayZ - lift);
    setRot(B.upperArmR, swayX * 0.9, 0.5 * DEG * drift2, swayZ + lift);
    const flex = 1.2 * DEG * Math.sin((TAU * t) / 11.3 + 0.3);
    setRot(B.forearmL, -flex, 0, 0);
    setRot(B.forearmR, flex * 0.8, 0, 0);
    setRot(B.handL, 0.8 * DEG * drift2, 0, 0.6 * DEG * drift1);
    setRot(B.handR, 0.8 * DEG * drift1, 0, -0.6 * DEG * drift3);

    // ---- legs: analytic 2-bone IK, feet planted at bind positions
    const pz = Math.cos(yaw), px = Math.sin(yaw);
    solveLeg(legs[0], px, pz);
    solveLeg(legs[1], px, pz);
  }

  update(0);
  object.updateMatrixWorld(true);

  function dispose() {
    geometry.dispose();
    material.dispose();
    skeleton.dispose();
  }

  return { object, update, dispose };
}
