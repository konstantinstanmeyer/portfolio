import type { SimTargets } from "./simulation";

/** Messages to the simulation worker. */
export type ToSim =
  | { type: "targets"; targets: SimTargets; width: number; height: number; spawn: "enter" | "home"; generation: number }
  | { type: "title"; index: number; home: Float32Array; generation: number }
  | { type: "reduced"; reduced: boolean }
  | { type: "pointer"; x: number; y: number; dt: number }
  | { type: "leave" }
  | { type: "holdStart"; x: number; y: number }
  | { type: "holdEnd" }
  | { type: "hover"; index: number | null }
  | { type: "pulse"; x: number; y: number }
  /** Advance by dt and send positions back in `buffer` (transferred both ways). */
  | { type: "step"; dt: number; idle: boolean; buffer: ArrayBuffer };

/** A finished step from the simulation worker. */
export interface SimFrameMessage {
  buffer: ArrayBuffer;
  count: number;
  steps: number;
  peakSpeed: number;
  holding: boolean;
  entering: boolean;
  generation: number;
}
