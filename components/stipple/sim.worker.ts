// Runs the particle simulation off the main thread. Each "step" message comes
// with a buffer to fill; it goes back (transferred, not copied) with the
// positions, so the page only has to draw.

import type { SimFrameMessage, ToSim } from "./sim-protocol";
import { ParticleField } from "./simulation";
import { EXTRA_GROUP } from "./stipple";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToSim>) => void) | null;
  postMessage(message: SimFrameMessage, transfer: Transferable[]): void;
};

/**
 * Runs every path once (intro, hover and title, hold, the bloom opening and
 * closing, release, idle, reduced motion) on throwaway dots, so the first
 * real press doesn't hit cold code that the JIT then has to deoptimise.
 * The targets are structured-cloned to match the shapes real ones arrive in.
 */
function warmUp(): void {
  const n = 3000;
  const home = new Float32Array(n * 2);
  const group = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    home[i * 2] = 300 + (i % 100) * 8;
    home[i * 2 + 1] = 250 + Math.floor(i / 100) * 8;
    group[i] = i % 10 === 0 ? 1 + ((i / 10) % 3) : i % 10 === 5 ? EXTRA_GROUP : 0;
  }
  const size = 64;
  const sdf = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sdf[y * size + x] = 20 - Math.hypot(x - 32, y - 32);
  const icons = [0, 1, 2].map((k) => ({ left: 400 + k * 90, top: 600, width: 60, height: 60 }));
  const targets = structuredClone({
    count: n,
    home,
    group,
    icons,
    iconField: { sdf, w: size, h: size, scale: 1, x: 400, y: 600 },
    blockHeight: 240,
  });
  const dt = 1 / 60;
  const run = (sim: ParticleField, frames: number, idle = false) => {
    for (let k = 0; k < frames; k++) sim.step(dt * (idle ? 2 : 1), idle);
  };

  const intro = new ParticleField();
  intro.setTargets(targets, 1440, 900, "enter");
  run(intro, 40);

  const sim = new ParticleField();
  sim.setTargets(targets, 1440, 900, "home");
  sim.setTitle(0, structuredClone(home));
  for (let k = 0; k < 20; k++) {
    sim.pointerMove(500 + k * 10, 400, dt);
    sim.step(dt);
  }
  sim.hoverIcon(0);
  run(sim, 30);
  sim.hoverIcon(1);
  run(sim, 10);
  sim.hoverIcon(null);
  sim.pulse(600, 500);
  sim.holdStart(700, 400);
  run(sim, 100); // long enough for the bloom to open
  for (let k = 0; k < 12; k++) {
    sim.pointerMove(700 + k * 40, 400, dt); // a flick closes it
    sim.step(dt);
  }
  run(sim, 60);
  sim.holdEnd();
  run(sim, 30);
  run(sim, 10, true);
  sim.setReducedMotion(true);
  run(sim, 5);
}
warmUp();

const field = new ParticleField();
let generation = 0;

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case "targets":
      generation = data.generation;
      field.setTargets(data.targets, data.width, data.height, data.spawn);
      break;
    case "title":
      if (data.generation === generation) field.setTitle(data.index, data.home);
      break;
    case "reduced":
      field.setReducedMotion(data.reduced);
      break;
    case "pointer":
      field.pointerMove(data.x, data.y, data.dt);
      break;
    case "leave":
      field.pointerLeave();
      break;
    case "holdStart":
      field.holdStart(data.x, data.y);
      break;
    case "holdEnd":
      field.holdEnd();
      break;
    case "hover":
      field.hoverIcon(data.index);
      break;
    case "beat":
      field.setBeat(data.on, data.from);
      break;
    case "pulse":
      field.pulse(data.x, data.y);
      break;
    case "step": {
      const steps = field.step(data.dt, data.idle);
      const n = field.count * 2;
      const buffer = data.buffer.byteLength >= n * 4 ? data.buffer : new ArrayBuffer(n * 4);
      new Float32Array(buffer, 0, n).set(field.pos.subarray(0, n));
      scope.postMessage(
        {
          buffer,
          count: field.count,
          steps,
          peakSpeed: field.peakSpeed,
          holding: field.holding,
          entering: field.entering,
          generation,
        },
        [buffer],
      );
      break;
    }
  }
};
