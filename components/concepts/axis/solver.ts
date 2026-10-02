import type { Metrics } from "./metrics";

export type Layout = {
  vw: number;
  vh: number;
  /** outer margin and row gap (px) */
  m: number;
  g: number;
  /** measure (inner width) */
  W: number;
  rows: number;
  start: number[];
  end: number[];
  /** font size per row, fixed until the next resize */
  fs: number[];
  /** cap height per row at rest */
  cap0: number[];
  top: number;
  /** the message band sits after this row */
  bandAfter: number;
  bandRest: number;
  bandOpen: number;
  /** distance from the rule to the bottom of the band */
  ruleBelow: number;
  /** gap between the rule and the typed baseline */
  lift: number;
  msgFs: number;
};

export type Frame = {
  /** inputs, written by the engine */
  e: Float32Array;
  grad: Float32Array;
  q: Float32Array;
  band: number;
  w0: number;
  /** outputs */
  x: Float32Array;
  y: Float32Array;
  fs: Float32Array;
  wd: Float32Array;
  wg: Float32Array;
  yt: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
  row: Int8Array;
  rowMid: Float32Array;
  rowCap: Float32Array;
  ruleY: number;
  bandTop: number;
};

export type Solver = ReturnType<typeof createSolver>;

/**
 * Fits the name to the viewport through the font's own axes.
 *
 * Self-contained on purpose: it is serialised into an inline script that lays
 * the letters out before first paint, so it must not reference module scope.
 */
export function createSolver(M: Metrics) {
  const NAME = "KONSTANTINSTANMEYER";
  const BREAK = 9;
  const N = NAME.length;
  const SPLITS = [
    { rows: [[0, 19]], band: 0, cost: 0 },
    { rows: [[0, 10], [10, 19]], band: 0, cost: 0 },
    { rows: [[0, 5], [5, 10], [10, 14], [14, 19]], band: 1, cost: 0.1 },
  ];
  const W0 = 230;
  const Y0 = 700;
  const REST_LO = 34;
  const REST_HI = 138;
  const SWELL_WD = 58;
  // Baseline offset of a `line-height: 0` box: (typoAscender - |typoDescender|) / 2 / upm.
  const BASE = (1900 - 500) / 2 / 2048;

  const glyph: number[] = [];
  const kern: (number[] | null)[] = [];
  for (let i = 0; i < N; i++) {
    glyph.push(M.glyphs.indexOf(NAME[i]));
    kern.push(i < N - 1 && i !== BREAK ? M.kern[NAME[i] + NAME[i + 1]] || null : null);
  }

  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

  function at(t: number[], wd: number, wg: number): number {
    let iw = 0;
    let tx = (wd - 25) / 75;
    if (wd > 100) {
      iw = 1;
      tx = (wd - 100) / 51;
    }
    let ig = 0;
    let ty = (wg - 100) / 300;
    if (wg > 400) {
      ig = 1;
      ty = (wg - 400) / 600;
    }
    tx = clamp(tx, 0, 1);
    ty = clamp(ty, 0, 1);
    const a = iw * 3 + ig;
    const lo = t[a] + (t[a + 3] - t[a]) * tx;
    const hi = t[a + 1] + (t[a + 4] - t[a + 1]) * tx;
    return lo + (hi - lo) * ty;
  }

  /** advance of letter i plus the kern or word space that follows it */
  function step(i: number, wd: ArrayLike<number>, wg: ArrayLike<number>, last: boolean): number {
    let w = at(M.adv[glyph[i]], wd[i], wg[i]);
    if (!last) {
      const mw = (wd[i] + wd[i + 1]) / 2;
      const mg = (wg[i] + wg[i + 1]) / 2;
      if (i === BREAK) w += at(M.space, mw, mg);
      else if (kern[i]) w += at(kern[i] as number[], mw, mg);
    }
    return w;
  }

  /** ink width in em of letters [a, b), side bearings of the outer letters removed */
  function ink(a: number, b: number, wd: ArrayLike<number>, wg: ArrayLike<number>): number {
    let w = 0;
    for (let i = a; i < b; i++) w += step(i, wd, wg, i === b - 1);
    const l = b - 1;
    return w - at(M.lo[glyph[a]], wd[a], wg[a]) - at(M.adv[glyph[l]], wd[l], wg[l]) + at(M.hi[glyph[l]], wd[l], wg[l]);
  }

  const uw = new Float32Array(N);
  const ug = new Float32Array(N);
  function inkUniform(a: number, b: number, wd: number, wg: number): number {
    uw.fill(wd);
    ug.fill(wg);
    return ink(a, b, uw, ug);
  }

  function rest(vw: number, vh: number): Layout {
    const m = Math.round(clamp(Math.min(vw, vh) * 0.028, 12, 40));
    const g = m;
    const W = vw - 2 * m;
    const H = vh - 2 * m;
    const y = Y0 / 1000;
    const bandRest = Math.round(Math.max(2 * g, 34));
    const ruleBelow = Math.max(g * 0.5, 8);
    const lift = Math.max(3, g * 0.22);
    const msgCap = clamp(H * 0.058, 20, 60);
    let best: Layout | null = null;
    let bestScore = -Infinity;
    for (const sp of SPLITS) {
      const R = sp.rows.length;
      const Hc = H - (R - 1) * g - bandRest + (sp.band === R - 1 ? 0 : g);
      if (Hc <= 0) continue;
      const lo: number[] = [];
      const hi: number[] = [];
      let sumLo = 0;
      let sumHi = 0;
      for (const [a, b] of sp.rows) {
        lo.push(W / inkUniform(a, b, REST_HI, W0));
        hi.push(W / inkUniform(a, b, REST_LO, W0));
        sumLo += lo[lo.length - 1] * y;
        sumHi += hi[hi.length - 1] * y;
      }
      let fs: number[];
      let fill: number;
      if (sumLo > Hc) {
        fs = lo;
        fill = Hc / sumLo - 1;
      } else if (sumHi <= Hc) {
        fs = hi;
        fill = sumHi / Hc;
      } else {
        let c0 = 0;
        let c1 = Math.max(...hi);
        for (let k = 0; k < 40; k++) {
          const c = (c0 + c1) / 2;
          let s = 0;
          for (let r = 0; r < R; r++) s += clamp(c, lo[r], hi[r]) * y;
          if (s > Hc) c1 = c;
          else c0 = c;
        }
        fs = lo.map((l, r) => clamp(c0, l, hi[r]));
        fill = 1;
      }
      const score = fill - sp.cost;
      if (score > bestScore) {
        bestScore = score;
        const yr = fill < 1 && fill > 0 ? Math.min(0.76, y / fill) : y;
        const cap0 = fs.map((f) => f * yr);
        const used = cap0.reduce((s, c) => s + c, 0);
        best = {
          vw,
          vh,
          m,
          g,
          W,
          rows: R,
          start: sp.rows.map((r) => r[0]),
          end: sp.rows.map((r) => r[1]),
          fs,
          cap0,
          top: m + Math.max(0, (Hc - used) / 2),
          bandAfter: sp.band,
          bandRest,
          bandOpen: Math.max(bandRest * 1.4, ruleBelow + lift + msgCap + Math.max(g * 0.95, 14)),
          ruleBelow,
          lift,
          msgFs: msgCap / 0.7109,
        };
      }
    }
    return best as Layout;
  }

  function frameState(L: Layout): Frame {
    return {
      e: new Float32Array(N),
      grad: new Float32Array(N),
      q: new Float32Array(L.rows).fill(1),
      band: L.bandRest,
      w0: W0,
      x: new Float32Array(N),
      y: new Float32Array(N),
      fs: new Float32Array(N),
      wd: new Float32Array(N),
      wg: new Float32Array(N),
      yt: new Float32Array(N),
      cx: new Float32Array(N),
      cy: new Float32Array(N),
      row: new Int8Array(N),
      rowMid: new Float32Array(5),
      rowCap: new Float32Array(5),
      ruleY: 0,
      bandTop: 0,
    };
  }

  const capT = new Float32Array(5);
  const ytR = new Float32Array(5);

  function setAxes(F: Frame, a: number, b: number, base: number, lam: number) {
    for (let i = a; i < b; i++) {
      const e = F.e[i] * lam;
      F.wd[i] = clamp(base + SWELL_WD * e, 25, 151);
      F.wg[i] = e >= 0 ? F.w0 + (1000 - F.w0) * Math.min(e, 1) : F.w0 + (F.w0 - 100) * Math.max(e, -1);
    }
  }

  function solveRow(F: Frame, a: number, b: number, target: number) {
    let eMin = 0;
    let eMax = 0;
    for (let i = a; i < b; i++) {
      eMin = Math.min(eMin, F.e[i]);
      eMax = Math.max(eMax, F.e[i]);
    }
    const lo = 25 - SWELL_WD * Math.min(eMax, 1);
    const hi = 151 - SWELL_WD * Math.max(eMin, -1);
    setAxes(F, a, b, lo, 1);
    if (ink(a, b, F.wd, F.wg) > target) {
      // too heavy to fit even fully condensed: give up some swell
      let l0 = 0;
      let l1 = 1;
      for (let k = 0; k < 18; k++) {
        const l = (l0 + l1) / 2;
        setAxes(F, a, b, lo, l);
        if (ink(a, b, F.wd, F.wg) > target) l1 = l;
        else l0 = l;
      }
      setAxes(F, a, b, lo, l0);
      return;
    }
    setAxes(F, a, b, hi, 1);
    if (ink(a, b, F.wd, F.wg) < target) return;
    let b0 = lo;
    let b1 = hi;
    for (let k = 0; k < 22; k++) {
      const c = (b0 + b1) / 2;
      setAxes(F, a, b, c, 1);
      if (ink(a, b, F.wd, F.wg) > target) b1 = c;
      else b0 = c;
    }
    setAxes(F, a, b, b0, 1);
  }

  function frame(L: Layout, F: Frame) {
    const R = L.rows;
    const g = L.g;
    let c0 = 0;
    let cq = 0;
    for (let r = 0; r < R; r++) {
      c0 += L.cap0[r];
      cq += L.cap0[r] * F.q[r];
    }
    // the band borrows its height from the letters
    const want = c0 - (F.band - L.bandRest);
    for (let pass = 0; pass < 3; pass++) {
      let free = 0;
      let got = 0;
      for (let r = 0; r < R; r++) {
        const c = pass === 0 ? (L.cap0[r] * F.q[r] * want) / cq : capT[r];
        ytR[r] = clamp((1000 * c) / L.fs[r], 528, 760);
        capT[r] = (L.fs[r] * ytR[r]) / 1000;
        got += capT[r];
        if (ytR[r] > 528 && ytR[r] < 760) free += capT[r];
      }
      const d = want - got;
      if (Math.abs(d) < 0.01 || free <= 0) break;
      for (let r = 0; r < R; r++) if (ytR[r] > 528 && ytR[r] < 760) capT[r] += (d * capT[r]) / free;
    }
    for (let r = 0; r < R; r++) {
      ytR[r] = clamp((1000 * capT[r]) / L.fs[r], 528, 760);
      capT[r] = (L.fs[r] * ytR[r]) / 1000;
    }
    let y = L.top;
    for (let r = 0; r < R; r++) {
      const base = y + capT[r];
      const fs = L.fs[r];
      const a = L.start[r];
      const b = L.end[r];
      solveRow(F, a, b, L.W / fs);
      const spare = b - a > 1 ? Math.max(0, L.W / fs - ink(a, b, F.wd, F.wg)) / (b - a - 1) : 0;
      let x = L.m - at(M.lo[glyph[a]], F.wd[a], F.wg[a]) * fs;
      for (let i = a; i < b; i++) {
        const adv = at(M.adv[glyph[i]], F.wd[i], F.wg[i]);
        F.x[i] = x;
        F.y[i] = base - BASE * fs;
        F.fs[i] = fs;
        F.yt[i] = ytR[r];
        F.row[i] = r;
        F.cx[i] = x + (adv * fs) / 2;
        F.cy[i] = base - capT[r] / 2;
        x += (step(i, F.wd, F.wg, i === b - 1) + spare) * fs;
      }
      F.rowMid[r] = base - capT[r] / 2;
      F.rowCap[r] = capT[r];
      if (r === L.bandAfter) {
        F.bandTop = base;
        F.ruleY = base + F.band - L.ruleBelow;
      }
      y = base + (r === L.bandAfter ? F.band : g);
    }
  }

  const last: string[] = [];
  const f1 = (v: number) => Math.round(v * 10) / 10;
  const f2 = (v: number) => Math.round(v * 100) / 100;

  function paint(L: Layout, F: Frame, els: ArrayLike<HTMLElement>, root: HTMLElement) {
    for (let i = 0; i < els.length && i < N; i++) {
      const s = els[i].style;
      const t = "translate3d(" + f2(F.x[i]) + "px," + f2(F.y[i]) + "px,0)";
      const v =
        '"wdth" ' + f2(F.wd[i]) + ', "wght" ' + f1(F.wg[i]) + ', "GRAD" ' + f1(F.grad[i]) + ', "YTUC" ' + f1(F.yt[i]) + ', "opsz" 144';
      const z = f2(F.fs[i]) + "px";
      if (last[i * 3] !== t) s.transform = last[i * 3] = t;
      if (last[i * 3 + 1] !== v) s.fontVariationSettings = last[i * 3 + 1] = v;
      if (last[i * 3 + 2] !== z) s.fontSize = last[i * 3 + 2] = z;
    }
    const band = "--band-top:" + f2(F.bandTop) + "px;--band-h:" + f2(F.band) + "px;--rule-y:" + f2(F.ruleY - F.bandTop) + "px";
    if (last[N * 3] !== band) {
      last[N * 3] = band;
      const s = root.style;
      s.setProperty("--band-top", f2(F.bandTop) + "px");
      s.setProperty("--band-h", f2(F.band) + "px");
      s.setProperty("--rule-y", f2(F.ruleY - F.bandTop) + "px");
    }
    const geo = L.m + "|" + L.g + "|" + L.msgFs + "|" + L.lift;
    if (last[N * 3 + 1] !== geo) {
      last[N * 3 + 1] = geo;
      const s = root.style;
      s.setProperty("--m", L.m + "px");
      s.setProperty("--g", L.g + "px");
      s.setProperty("--msg-fs", f2(L.msgFs) + "px");
      s.setProperty("--lift", f2(L.lift) + "px");
      s.setProperty("--mo", String(Math.round(clamp(L.msgFs, 8, 144))));
    }
  }

  function boot(root: HTMLElement | null) {
    if (!root) return;
    const L = rest(root.clientWidth, root.clientHeight);
    const F = frameState(L);
    frame(L, F);
    paint(L, F, root.querySelectorAll<HTMLElement>("[data-l]"), root);
    root.setAttribute("data-boot", "");
  }

  return { N, W0, rest, frameState, frame, paint, boot };
}
