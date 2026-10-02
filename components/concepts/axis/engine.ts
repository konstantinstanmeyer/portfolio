import { METRICS } from "./metrics";
import { createSolver } from "./solver";

export type Engine = {
  /** open the message band (it borrows its height from the name) */
  setOpen(open: boolean): void;
  /** send a pulse through every letter, starting at the left (1) or right (-1) edge */
  pluck(dir: 1 | -1, strength?: number, delay?: number): void;
  /** a local nudge to the rows either side of the band, e.g. from a keystroke */
  poke(x: number, strength: number): void;
  setReduced(reduced: boolean): void;
  destroy(): void;
};

type Options = { root: HTMLElement; letters: HTMLElement[]; reduced: boolean };

const SUB = 1 / 120;
const IDLE_AFTER = 2400;
const PULSE_W = 0.11;

export function createEngine({ root, letters, reduced: startReduced }: Options): Engine {
  const S = createSolver(METRICS);
  const n = S.N;
  let L = S.rest(root.clientWidth, root.clientHeight);
  const F = S.frameState(L);

  const ev = new Float32Array(n);
  const pulseAt = new Float32Array(n).fill(-1);
  const pulseAmp = new Float32Array(n);
  const qv = new Float32Array(5);
  const target = new Float32Array(n);
  const rowW = new Float32Array(5);

  let reduced = startReduced;
  let px = -1e4;
  let py = -1e4;
  let vx = 0;
  let vy = 0;
  let lastMoveT = 0;
  let over = false;
  let down = false;
  let presence = 0;
  let idle = 0;
  let press = 0;
  let lastInput = -1e9;
  let open = false;
  let hoverRule = false;
  let bandV = 0;
  let t = 0;
  let prev = 0;
  let raf = 0;
  let alive = true;

  const bandTarget = () => (open ? L.bandOpen : hoverRule ? L.bandRest * 1.35 : L.bandRest);

  const wake = () => {
    if (!raf && alive && !document.hidden) raf = requestAnimationFrame(tick);
  };

  function integrate(dt: number, now: number) {
    const k = reduced ? 34 : 64;
    const c = reduced ? 2 * Math.sqrt(k) : 2 * 0.3 * Math.sqrt(k);
    const couple = reduced ? 0 : 60;
    const want = over || down ? 1 : 0;
    presence += (want - presence) * (1 - Math.exp(-dt * (want ? 7 : 2.2)));
    const idleWant = !reduced && now - lastInput > IDLE_AFTER ? 1 : 0;
    idle += (idleWant - idle) * (1 - Math.exp(-dt * (idleWant ? 1.1 : 3.5)));
    press += ((down ? 1 : 0) - press) * (1 - Math.exp(-dt * 10));
    const decay = Math.exp(-dt * 7);
    vx *= decay;
    vy *= decay;
    const fsRef = L.fs[0];
    const speed = Math.min(Math.hypot(vx, vy) / fsRef, 8);
    const R = L.rows;

    for (let i = 0; i < n; i++) {
      const r = F.row[i];
      const sx = F.fs[i] * (0.3 + 0.1 * press);
      const sy = F.rowCap[r] * 0.72;
      const dx = (px - F.cx[i]) / sx;
      const dy = (py - F.cy[i]) / sy;
      const f = presence * Math.exp(-(dx * dx + dy * dy) * 0.5);
      let tg = f * (0.95 + 0.35 * press);
      if (idle > 0.001) {
        const xi = (F.cx[i] - L.m) / L.W;
        const w = 0.5 + 0.5 * Math.sin(t * 0.62 + 3 - xi * 5.4 + r * 1.6);
        tg += idle * 0.78 * w * w * w * w;
      }
      if (pulseAt[i] >= 0) {
        const u = (t - pulseAt[i]) / PULSE_W;
        tg += pulseAmp[i] * Math.exp(-u * u);
        if (u > 3) pulseAt[i] = -1;
      }
      target[i] = tg;
      if (!reduced) ev[i] += f * speed * 3 * dt;
      const gt = reduced ? 0 : Math.min(150, speed * 55 * f) - 60 * idle * (1 - Math.min(1, F.e[i] * 2));
      F.grad[i] += (gt - F.grad[i]) * (1 - Math.exp(-dt * 6));
    }
    for (let i = 0; i < n; i++) {
      const r = F.row[i];
      const l = i > 0 && F.row[i - 1] === r ? F.e[i - 1] : F.e[i];
      const rr = i < n - 1 && F.row[i + 1] === r ? F.e[i + 1] : F.e[i];
      const a = k * (target[i] - F.e[i]) - c * ev[i] + couple * (l + rr - 2 * F.e[i]);
      ev[i] += a * dt;
    }
    for (let i = 0; i < n; i++) F.e[i] += ev[i] * dt;

    // rows trade height toward the pointer
    let mean = 0;
    for (let r = 0; r < R; r++) {
      const d = (py - F.rowMid[r]) / (F.rowCap[r] * 0.9);
      const w = presence * Math.exp(-d * d);
      mean += w / R;
      rowW[r] = w;
    }
    const gamma = reduced ? 0 : 0.2;
    for (let r = 0; r < R; r++) {
      const qt = 1 + gamma * (rowW[r] - mean);
      const a = 38 * (qt - F.q[r]) - 2 * 0.55 * Math.sqrt(38) * qv[r];
      qv[r] += a * dt;
      F.q[r] += qv[r] * dt;
    }

    const bt = bandTarget();
    const bk = 150;
    const bc = 2 * (reduced ? 1 : 0.5) * Math.sqrt(bk);
    bandV += (bk * (bt - F.band) - bc * bandV) * dt;
    F.band += bandV * dt;
  }

  function settled(): boolean {
    if (idle > 0.002 || presence > 0.002 || press > 0.002) return false;
    if (Math.abs(bandV) > 0.01 || Math.abs(bandTarget() - F.band) > 0.05) return false;
    for (let i = 0; i < n; i++) {
      if (Math.abs(ev[i]) > 1e-3 || Math.abs(F.e[i]) > 1e-3 || pulseAt[i] >= 0 || Math.abs(F.grad[i]) > 0.05) return false;
    }
    for (let r = 0; r < L.rows; r++) if (Math.abs(qv[r]) > 1e-4 || Math.abs(F.q[r] - 1) > 1e-4) return false;
    return true;
  }

  /** nobody is interacting: the slow idle swell reads the same at half the frame rate */
  function calm(): boolean {
    if (presence > 0.01 || press > 0.01 || Math.abs(bandV) > 0.05) return false;
    for (let i = 0; i < n; i++) if (pulseAt[i] >= 0) return false;
    return true;
  }

  function tick(now: number) {
    raf = 0;
    if (prev && now - prev < 30 && calm()) {
      wake();
      return;
    }
    const dt = prev ? Math.min(0.05, (now - prev) / 1000) : 1 / 60;
    prev = now;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(SUB, left);
      t += h;
      integrate(h, now);
      left -= h;
    }
    S.frame(L, F);
    S.paint(L, F, letters, root);
    if (settled()) prev = 0;
    else wake();
  }

  const onMove = (e: PointerEvent) => {
    const mouse = e.pointerType === "mouse";
    const x = e.clientX;
    const y = e.clientY;
    const ts = e.timeStamp;
    if (px > -1e3 && ts > lastMoveT) {
      const k = Math.min(1, (ts - lastMoveT) / 40);
      const d = Math.max(4, ts - lastMoveT) / 1000;
      vx += ((x - px) / d - vx) * k;
      vy += ((y - py) / d - vy) * k;
    }
    lastMoveT = ts;
    px = x;
    py = y;
    if (mouse) over = true;
    lastInput = performance.now();
    hoverRule = mouse && Math.abs(y - F.ruleY) < Math.max(L.g * 0.9, 16);
    wake();
  };
  const onDown = (e: PointerEvent) => {
    onMove(e);
    down = true;
    vx = vy = 0;
    wake();
  };
  const onUp = (e: PointerEvent) => {
    down = false;
    if (e.pointerType !== "mouse") {
      over = false;
      hoverRule = false;
    }
    lastInput = performance.now();
    wake();
  };
  const onLeave = () => {
    over = false;
    down = false;
    hoverRule = false;
    lastInput = performance.now();
    wake();
  };
  const onVisible = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      prev = 0;
    } else wake();
  };
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === L.vw && h === L.vh) return;
    const rows = L.rows;
    L = S.rest(w, h);
    if (L.rows !== rows) {
      F.q.fill(1);
      qv.fill(0);
    }
    if (!open) F.band = L.bandRest;
    S.frame(L, F);
    S.paint(L, F, letters, root);
    wake();
  });

  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisible);
  ro.observe(root);

  S.frame(L, F);
  S.paint(L, F, letters, root);

  const api: Engine = {
    setOpen(v) {
      if (open === v) return;
      open = v;
      lastInput = performance.now();
      wake();
    },
    pluck(dir, strength = 1, delay = 0) {
      const origin = dir > 0 ? L.m : L.m + L.W;
      for (let i = 0; i < n; i++) {
        const r = F.row[i];
        const near = r === L.bandAfter || r === L.bandAfter + 1 ? 1 : 0.7;
        pulseAt[i] = t + delay + (reduced ? 0.1 : (0.95 * Math.abs(F.cx[i] - origin)) / L.W + Math.abs(r - L.bandAfter - 0.5) * 0.06);
        pulseAmp[i] = (reduced ? 0.35 : 1.15) * near * strength;
      }
      wake();
    },
    poke(x, strength) {
      lastInput = performance.now();
      for (let i = 0; i < n; i++) {
        const r = F.row[i];
        if (r !== L.bandAfter && r !== L.bandAfter + 1) continue;
        const d = (F.cx[i] - x) / (F.fs[i] * 0.45);
        const amp = strength * Math.exp(-d * d) * (reduced ? 0.4 : 1);
        if (Math.abs(amp) < 0.02) continue;
        pulseAt[i] = t + 0.05 + Math.abs(r - L.bandAfter - 0.5) * 0.04;
        pulseAmp[i] = amp;
      }
      wake();
    },
    setReduced(v) {
      reduced = v;
      wake();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
  // a first breath, so the material announces itself
  if (!reduced) api.pluck(1, 0.8, 0.5);
  wake();
  return api;
}
