import type * as THREE from "three";

/**
 * A self-contained, animated human figure.
 *
 * Conventions: ~1.75 m tall, feet resting on y = 0, facing +Z, centred on the
 * origin. The scene adds `object` once, calls `update` every frame and
 * `dispose` on unmount.
 */
export interface Figure {
  object: THREE.Object3D;
  /** `t` is elapsed seconds, `dt` the seconds since the previous frame. */
  update(t: number, dt: number): void;
  /** Frees every geometry and material the figure created. */
  dispose(): void;
}

export interface FigureOptions {
  /** Facet edge line colour (hex). */
  edgeColor?: number;
  /** Facet edge line opacity, 0–1. */
  edgeOpacity?: number;
  /** Base surface colour (hex). */
  baseColor?: number;
}
