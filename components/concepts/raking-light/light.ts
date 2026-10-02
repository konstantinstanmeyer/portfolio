import type { Layout } from "./layout";

type Mode = "auto" | "pointer" | "touch";

// The orbit starts just below the first letters, heading right.
const PHASE_X = -0.6;
const PHASE_Y = 0.88;

/** A small lamp hovering just above the paper: follows the pointer, a finger, or its own slow orbit. */
export class LightRig {
  x = 0;
  y = 0;
  z = 60;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private tx = 0;
  private ty = 0;
  private mode: Mode = "auto";
  private px = 0;
  private py = 0;
  private leftAt = -1;
  private phase = 0;
  private lower = false;
  private lift = 1;
  private placed = false;

  pointer(x: number, y: number) {
    this.mode = "pointer";
    this.px = x;
    this.py = y;
    this.leftAt = -1;
  }

  touch(x: number, y: number) {
    this.mode = "touch";
    this.px = x;
    this.py = y - 56;
    this.lower = true;
  }

  release(now: number) {
    this.lower = false;
    if (this.mode === "touch") {
      this.mode = "auto";
      this.leftAt = now;
    }
  }

  press(down: boolean) {
    this.lower = down;
  }

  leave(now: number) {
    if (this.mode === "pointer") this.leftAt = now;
  }

  wheel(dy: number) {
    this.lift = Math.min(3, Math.max(0.4, this.lift * Math.exp(dy * 0.0015)));
  }

  /** Whether the lamp is still travelling (drives redraws when nothing else changes). */
  get moving() {
    return (
      this.mode !== "pointer" ||
      Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.vz) > 0.02 ||
      Math.abs(this.tx - this.x) + Math.abs(this.ty - this.y) > 0.05
    );
  }

  update(dt: number, now: number, L: Layout, reduced: boolean, focusSlot: boolean) {
    const nb = L.nameBox;
    const cx = nb.x + nb.w / 2;
    const cy = nb.y + nb.h / 2;
    const ax = Math.max(nb.w * 0.5, 100);
    const ay = Math.max(nb.h * 1.1, 80);
    const base = Math.min(34, Math.max(14, Math.min(L.width, L.height) * 0.026));

    if (!this.placed) {
      this.placed = true;
      this.x = reduced ? nb.x + nb.w * 0.1 : cx + ax * Math.sin(PHASE_X);
      this.y = reduced ? nb.y - ay * 0.6 : cy + ay * Math.sin(PHASE_Y);
      this.z = base;
    }
    if (this.mode === "pointer" && this.leftAt > 0 && now - this.leftAt > 1.4) this.mode = "auto";

    if (this.mode === "auto") {
      if (focusSlot) {
        this.tx = L.slot.x + L.slot.w * 0.08;
        this.ty = L.slot.y - L.slot.h * 0.9;
      } else if (reduced) {
        this.tx = nb.x + nb.w * 0.1;
        this.ty = nb.y - ay * 0.6;
      } else {
        this.phase += dt * 0.2;
        this.tx = cx + ax * Math.sin(this.phase * 0.9 + PHASE_X);
        this.ty = cy + ay * Math.sin(this.phase * 1.7 + PHASE_Y);
      }
    } else {
      this.tx = this.px;
      this.ty = this.py;
    }
    const tz = base * this.lift * (this.lower ? 0.55 : 1) * (focusSlot && this.mode === "auto" ? 0.7 : 1);

    const w = this.mode === "auto" ? (reduced ? 4 : 1.9) : 12;
    // Fixed substeps keep the springs identical on slow and fast displays.
    const steps = Math.min(16, Math.ceil(dt * 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vx += (w * w * (this.tx - this.x) - 2 * w * this.vx) * h;
      this.vy += (w * w * (this.ty - this.y) - 2 * w * this.vy) * h;
      this.vz += (36 * (tz - this.z) - 12 * this.vz) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.z += this.vz * h;
    }
  }
}
