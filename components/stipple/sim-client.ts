// The page's handle on the particle simulation. It runs in a worker when it
// can (so physics never competes with input or drawing) and on the main
// thread otherwise; either way the page asks for a step each frame and draws
// whichever finished frame is newest.

import type { SimFrameMessage, ToSim } from "./sim-protocol";
import { ParticleField, type SimTargets } from "./simulation";

export interface SimFrame {
  pos: Float32Array;
  count: number;
  steps: number;
}

export interface Sim {
  /** As of the newest finished frame. */
  readonly peakSpeed: number;
  readonly holding: boolean;
  readonly entering: boolean;
  setTargets(targets: SimTargets, width: number, height: number, spawn: "enter" | "home"): void;
  setTitle(index: number, home: Float32Array): void;
  setReducedMotion(reduced: boolean): void;
  pointerMove(x: number, y: number, dt: number): void;
  pointerLeave(): void;
  holdStart(x: number, y: number): void;
  holdEnd(): void;
  hoverIcon(index: number | null): void;
  /** Starts or stops the name's heartbeat (moving its dots from index `from` on). */
  setBeat(on: boolean, from: number): void;
  pulse(x: number, y: number): void;
  /** Advance by dt. If the previous step is still running, dt carries over. */
  request(dt: number, idle: boolean): void;
  /** The newest finished frame since the last call, if any. */
  take(): SimFrame | null;
  /** Hand a drawn frame's buffer back for reuse. */
  release(frame: SimFrame): void;
  dispose(): void;
}

class LocalSim implements Sim {
  private field = new ParticleField();
  private frame: SimFrame | null = null;
  get peakSpeed() {
    return this.field.peakSpeed;
  }
  get holding() {
    return this.field.holding;
  }
  get entering() {
    return this.field.entering;
  }
  setTargets(targets: SimTargets, width: number, height: number, spawn: "enter" | "home") {
    this.field.setTargets(targets, width, height, spawn);
  }
  setTitle(index: number, home: Float32Array) {
    this.field.setTitle(index, home);
  }
  setReducedMotion(reduced: boolean) {
    this.field.setReducedMotion(reduced);
  }
  pointerMove(x: number, y: number, dt: number) {
    this.field.pointerMove(x, y, dt);
  }
  pointerLeave() {
    this.field.pointerLeave();
  }
  holdStart(x: number, y: number) {
    this.field.holdStart(x, y);
  }
  holdEnd() {
    this.field.holdEnd();
  }
  hoverIcon(index: number | null) {
    this.field.hoverIcon(index);
  }
  setBeat(on: boolean, from: number) {
    this.field.setBeat(on, from);
  }
  pulse(x: number, y: number) {
    this.field.pulse(x, y);
  }
  request(dt: number, idle: boolean) {
    const steps = this.field.step(dt, idle);
    this.frame = { pos: this.field.pos, count: this.field.count, steps };
  }
  take() {
    const frame = this.frame;
    this.frame = null;
    return frame;
  }
  release() {}
  dispose() {}
}

class WorkerSim implements Sim {
  peakSpeed = 0;
  holding = false;
  entering = false;
  private worker: Worker;
  private generation = 0;
  private busy = false;
  private wanted = false;
  private idle = false;
  private carry = 0;
  private spare: ArrayBuffer[] = [];
  private latest: SimFrame | null = null;

  constructor(onFail: (error: unknown) => void) {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onerror = (event) => {
      event.preventDefault();
      onFail(event);
    };
    this.worker.onmessage = ({ data }: MessageEvent<SimFrameMessage>) => {
      this.busy = false;
      if (data.generation !== this.generation) {
        this.spare.push(data.buffer);
        this.flush();
        return;
      }
      this.peakSpeed = data.peakSpeed;
      this.holding = data.holding;
      this.entering = data.entering;
      // Only the newest frame matters; recycle one that was never drawn.
      if (this.latest) this.spare.push(this.latest.pos.buffer as ArrayBuffer);
      this.latest = { pos: new Float32Array(data.buffer, 0, data.count * 2), count: data.count, steps: data.steps };
      // A frame asked for while this step ran starts now, not a frame later.
      this.flush();
    };
  }

  private post(message: ToSim, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  setTargets(targets: SimTargets, width: number, height: number, spawn: "enter" | "home") {
    this.generation++;
    const { count, home, group, icons, iconField, blockHeight } = targets;
    this.post({
      type: "targets",
      targets: { count, home, group, icons, iconField, blockHeight },
      width,
      height,
      spawn,
      generation: this.generation,
    });
    this.entering = spawn === "enter";
    if (this.latest) this.spare.push(this.latest.pos.buffer as ArrayBuffer);
    this.latest = null;
  }
  setTitle(index: number, home: Float32Array) {
    this.post({ type: "title", index, home, generation: this.generation });
  }
  setReducedMotion(reduced: boolean) {
    this.post({ type: "reduced", reduced });
  }
  pointerMove(x: number, y: number, dt: number) {
    this.post({ type: "pointer", x, y, dt });
  }
  pointerLeave() {
    this.post({ type: "leave" });
  }
  holdStart(x: number, y: number) {
    this.holding = true;
    this.post({ type: "holdStart", x, y });
  }
  holdEnd() {
    this.post({ type: "holdEnd" });
  }
  hoverIcon(index: number | null) {
    this.post({ type: "hover", index });
  }
  setBeat(on: boolean, from: number) {
    this.post({ type: "beat", on, from });
  }
  pulse(x: number, y: number) {
    this.post({ type: "pulse", x, y });
  }
  request(dt: number, idle: boolean) {
    this.carry += dt;
    this.idle = idle;
    this.wanted = true;
    if (!this.busy) this.flush();
  }
  private flush() {
    if (!this.wanted) return;
    const buffer = this.spare.pop() ?? new ArrayBuffer(0);
    this.post({ type: "step", dt: this.carry, idle: this.idle, buffer }, [buffer]);
    this.carry = 0;
    this.wanted = false;
    this.busy = true;
  }
  take() {
    const frame = this.latest;
    this.latest = null;
    return frame;
  }
  release(frame: SimFrame) {
    this.spare.push(frame.pos.buffer as ArrayBuffer);
  }
  dispose() {
    this.worker.terminate();
  }
}

/**
 * A simulation in a worker, or on the main thread when workers aren't
 * available. If the worker fails to start, the replay brings a main-thread
 * one up to the same state.
 */
export function createSim(): Sim {
  if (typeof Worker === "undefined") return new LocalSim();
  // Everything that shapes the simulation, so a fallback can pick up.
  let targets: [SimTargets, number, number, "enter" | "home"] | null = null;
  const titles: Float32Array[] = [];
  let reduced = false;
  let hover: number | null = null;
  let beat: [boolean, number] = [false, 0];
  // Whether any frame of the current targets was shown (if not, the intro can still play).
  let shown = false;
  let active: Sim;
  const fallback = () => {
    active.dispose();
    active = new LocalSim();
    active.setReducedMotion(reduced);
    if (targets) active.setTargets(targets[0], targets[1], targets[2], shown ? "home" : targets[3]);
    titles.forEach((home, i) => home && active.setTitle(i, home));
    if (hover !== null) active.hoverIcon(hover);
    active.setBeat(...beat);
  };
  try {
    active = new WorkerSim(fallback);
  } catch {
    return new LocalSim();
  }
  return {
    get peakSpeed() {
      return active.peakSpeed;
    },
    get holding() {
      return active.holding;
    },
    get entering() {
      return active.entering;
    },
    setTargets(t, width, height, spawn) {
      targets = [t, width, height, spawn];
      shown = false;
      titles.length = 0;
      active.setTargets(t, width, height, spawn);
    },
    setTitle(index, home) {
      titles[index] = home;
      active.setTitle(index, home);
    },
    setReducedMotion(value) {
      reduced = value;
      active.setReducedMotion(value);
    },
    pointerMove: (x, y, dt) => active.pointerMove(x, y, dt),
    pointerLeave: () => active.pointerLeave(),
    holdStart: (x, y) => active.holdStart(x, y),
    holdEnd: () => active.holdEnd(),
    hoverIcon(index) {
      hover = index;
      active.hoverIcon(index);
    },
    setBeat(on, from) {
      beat = [on, from];
      active.setBeat(on, from);
    },
    pulse: (x, y) => active.pulse(x, y),
    request: (dt, idle) => active.request(dt, idle),
    take() {
      const frame = active.take();
      if (frame) shown = true;
      return frame;
    },
    release: (frame) => active.release(frame),
    dispose: () => active.dispose(),
  };
}
