import type { Rect } from "./masks";
import { approach, smooth } from "./math";

// The pointer is the antenna: proximity to the name raises coherence, a lens of
// full coherence follows it, and horizontal strokes over the name drag the carrier.
// With nobody steering (touch idle, no mouse yet), an autonomous tuner wanders
// across the name and keeps it locked.
export type Tuner = {
  lensX: number;
  lensY: number;
  coherence: number;
  pulse: number;
  driftA: number;
  driftB: number;
  update(now: number, dt: number, t: number, view: Rect, name: Rect, focused: boolean, reduced: boolean): void;
  dispose(): void;
};

const AUTO = 0.9;
const FAR = 0.26;
const DRIFT = 34;

export function createTuner(form: HTMLElement): Tuner {
  let px = 0;
  let py = 0;
  let active = false;
  let touch = false;
  let last = -1e9;
  let tapAt = -1e9;
  let vx = 0;
  let steer = 0;
  let brush = 0;

  const onMove = (e: PointerEvent) => {
    const now = performance.now();
    const gap = now - last;
    if (active && gap > 0 && gap < 100) {
      const v = ((e.clientX - px) / gap) * 1000;
      vx += (Math.max(-3000, Math.min(3000, v)) - vx) * 0.5;
    }
    px = e.clientX;
    py = e.clientY;
    active = true;
    touch = e.pointerType !== "mouse";
    last = now;
  };
  const onDown = (e: PointerEvent) => {
    active = false;
    onMove(e);
    if (!form.contains(e.target as Node)) tapAt = last;
  };
  const onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) active = false;
  };
  const onBlur = () => {
    active = false;
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("mouseout", onOut);
  window.addEventListener("blur", onBlur);

  const tuner: Tuner = {
    lensX: -1,
    lensY: -1,
    coherence: AUTO,
    pulse: 0,
    driftA: 0,
    driftB: 0,
    update(now, dt, t, view, name, focused, reduced) {
      const ax = name.x + name.w * (0.5 + (reduced ? 0 : 0.42 * Math.sin(t * 0.19)));
      const ay = name.y + name.h * (0.5 + (reduced ? 0 : 0.34 * Math.sin(t * 0.31 + 1.2)));
      const steering = active && now - last < (touch ? 3200 : 9000);
      steer = approach(steer, steering ? 1 : 0, steering ? 5 : 0.5, dt);
      if (tuner.lensX < 0) {
        tuner.lensX = ax;
        tuner.lensY = ay;
      }
      const follow = reduced ? 30 : touch ? 9 : 6;
      tuner.lensX = approach(tuner.lensX, ax + (px - ax) * steer, follow, dt);
      tuner.lensY = approach(tuner.lensY, ay + (py - ay) * steer, follow, dt);

      const dx = Math.max(name.x - px, 0, px - (name.x + name.w));
      const dy = Math.max(name.y - py, 0, py - (name.y + name.h));
      const dist = Math.hypot(dx, dy);
      const near = 1 - smooth(0, Math.min(view.w, view.h) * 0.3, dist);
      tuner.pulse = Math.exp(-(now - tapAt) / 700);
      const steered = Math.max(focused ? 0.7 : FAR, FAR + 0.5 * near);
      const target = Math.min(1, AUTO + (steered - AUTO) * steer + tuner.pulse * 0.6);
      tuner.coherence = approach(tuner.coherence, target, 2.2, dt);

      vx = approach(vx, 0, 5, dt);
      const over = 1 - smooth(0, 60, dist);
      brush = approach(brush, reduced ? 0 : vx * over * steer, 10, dt);
      const base = reduced ? 2 : DRIFT;
      tuner.driftA += (base + brush) * dt;
      tuner.driftB += (-base + brush) * dt;
    },
    dispose() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("blur", onBlur);
    },
  };
  return tuner;
}
