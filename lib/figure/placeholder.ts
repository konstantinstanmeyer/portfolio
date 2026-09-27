import * as THREE from "three";
import type { Figure, FigureOptions } from "./types";

// Rough stand-in for the final figure: a low-poly mannequin built from
// tapered prisms, ~1.75 m tall, feet on y = 0, facing +Z. Good enough to
// judge lighting and composition; swapped out via lib/figure/index.ts.

const TAU = Math.PI * 2;

export function createFigure(options: FigureOptions = {}): Figure {
  const {
    edgeColor = 0x121212,
    edgeOpacity = 0.6,
    baseColor = 0x9a9892,
  } = options;

  const surface = new THREE.MeshStandardMaterial({
    color: baseColor,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
    // Push faces back a touch so the edge lines never z-fight.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edges = new THREE.LineBasicMaterial({
    color: edgeColor,
    transparent: edgeOpacity < 1,
    opacity: edgeOpacity,
  });
  const geometries: THREE.BufferGeometry[] = [];

  /** Adds a flat-shaded mesh with its facet edges to `parent`. */
  function part(
    geometry: THREE.BufferGeometry,
    parent: THREE.Object3D,
    [x, y, z]: [number, number, number],
    [sx, sy, sz]: [number, number, number] = [1, 1, 1],
  ) {
    const outline = new THREE.EdgesGeometry(geometry, 20);
    geometries.push(geometry, outline);
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.add(new THREE.LineSegments(outline, edges));
    parent.add(mesh);
    return mesh;
  }

  /** Tapered prism hanging down from its top (the pivot is at y = 0). */
  function prism(rTop: number, rBottom: number, length: number, sides: number) {
    return new THREE.CylinderGeometry(rTop, rBottom, length, sides).translate(
      0,
      -length / 2,
      0,
    );
  }

  function group(parent: THREE.Object3D, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  const root = new THREE.Group();
  root.name = "figure";
  const body = group(root); // pivots on the ground for weight shift

  // Legs
  for (const side of [-1, 1]) {
    const x = side * 0.095;
    part(prism(0.085, 0.058, 0.42, 6), body, [x, 0.93, 0]);
    part(prism(0.056, 0.038, 0.42, 6), body, [x * 0.97, 0.51, -0.005]);
    part(new THREE.BoxGeometry(0.085, 0.07, 0.24), body, [x, 0.035, 0.05]);
  }

  // Hips up
  const upper = group(body, 0, 0.95, 0);
  part(prism(0.15, 0.125, 0.2, 6), upper, [0, 0.07, 0], [1, 1, 0.62]);

  const torso = group(upper, 0, 0.07, 0);
  part(prism(0.135, 0.14, 0.2, 6), torso, [0, 0.2, 0], [1, 1, 0.62]);
  const chest = part(prism(0.2, 0.14, 0.26, 6), torso, [0, 0.45, 0], [1, 1, 0.6]);
  part(prism(0.046, 0.054, 0.1, 5), torso, [0, 0.54, 0]);

  const head = group(torso, 0, 0.51, 0);
  part(new THREE.IcosahedronGeometry(0.105, 0), head, [0, 0.105, 0.005], [0.86, 1.12, 0.98]);

  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const shoulder = group(torso, side * 0.215, 0.41, 0);
    shoulder.rotation.z = side * 0.09;
    part(prism(0.05, 0.04, 0.3, 5), shoulder, [0, 0, 0]);
    const elbow = group(shoulder, 0, -0.3, 0);
    elbow.rotation.x = -0.12;
    part(prism(0.04, 0.03, 0.27, 5), elbow, [0, 0, 0]);
    part(prism(0.03, 0.022, 0.1, 4), elbow, [0, -0.27, 0], [1, 1, 0.6]);
    arms.push(shoulder);
  }

  return {
    object: root,
    update(t) {
      const breath = Math.sin((t * TAU) / 4.6);
      const sway = Math.sin((t * TAU) / 9.5);

      body.rotation.z = 0.008 * sway;
      upper.rotation.z = -0.012 * sway;
      torso.rotation.x = -0.006 * breath;
      chest.scale.set(1 + 0.012 * breath, 1 + 0.006 * breath, 0.6 * (1 + 0.025 * breath));

      head.rotation.y = 0.07 * Math.sin((t * TAU) / 13 + 1);
      head.rotation.x = 0.015 * Math.sin((t * TAU) / 7.3);

      arms[0].rotation.x = 0.022 * Math.sin((t * TAU) / 4.6 + 0.4);
      arms[1].rotation.x = 0.022 * Math.sin((t * TAU) / 4.6 + 0.9);
      arms[0].rotation.z = -(0.09 + 0.008 * breath);
      arms[1].rotation.z = 0.09 + 0.008 * breath;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      surface.dispose();
      edges.dispose();
    },
  };
}
