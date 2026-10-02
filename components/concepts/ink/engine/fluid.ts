import {
  blankStamp,
  createDouble,
  createProgram,
  createTarget,
  deleteTarget,
  detectFormats,
  uploadStamp,
  type DoubleTarget,
  type Formats,
  type Program,
  type Target,
} from "./gl";
import * as S from "./shaders";

export type Rect = { x: number; y: number; w: number; h: number };

export type InkCallbacks = {
  onFirstFrame?: () => void;
  onLost?: () => void;
  onSlow?: () => void;
};

const PAPER = [0.945, 0.929, 0.898] as const;
const INK = [0.067, 0.063, 0.062] as const;

const MAX_FORCES = 96;
const MAX_WASH = 32;
const DROPS = 4;
const SIM_SHORT = 128;
const PRESSURE_ITERS = 22;
const LIFT_TIME = 1.4;

type Programs = {
  splat: Program;
  curl: Program;
  force: Program;
  divergence: Program;
  scale: Program;
  jacobi: Program;
  gradient: Program;
  advect: Program;
  memory: Program;
  wash: Program;
  paper: Program;
  display: Program;
};

type Targets = {
  vel: DoubleTarget;
  pressure: DoubleTarget;
  div: Target;
  curl: Target;
  disp: DoubleTarget;
  wash: DoubleTarget;
  paper: Target;
};

type StampState = {
  tex: WebGLTexture;
  rect: Float32Array; // uv: x, y (bottom), w, h
  size: Float32Array; // texels
  source: HTMLCanvasElement | null;
  css: Rect;
};

/**
 * Stable-fluids ink. The name is not dye that gets smeared and lost: every pixel
 * carries a reference map back to where its ink came from, and the map relaxes
 * home when the water calms, so the letters always find their shape again.
 */
export class InkFluid {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly cb: InkCallbacks;
  private readonly reduced: boolean;
  private formats: Formats | null = null;
  private p: Programs | null = null;
  private t: Targets | null = null;
  private quad: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private name: StampState | null = null;
  private msg: StampState | null = null;

  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private simW = 1;
  private simH = 1;
  private aspect = 1;

  private readonly simTexel = new Float32Array(2);
  private readonly px = new Float32Array(2);
  private readonly forces = new Float32Array(MAX_FORCES * 5);
  private nForces = 0;
  private readonly washes = new Float32Array(MAX_WASH * 4);
  private nWashes = 0;
  private readonly drops = new Float32Array(DROPS * 4);
  private readonly dropPeak = new Float32Array(DROPS);
  private readonly dropAge = new Float32Array(DROPS);
  private dropNext = 0;

  private bleed = 1.4;
  private msgAlpha = 0;
  private msgReset = false;
  private liftLeft = 0;
  private shredAt = -1;

  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private lost = false;
  private drawn = false;
  private lastInput = -10;
  private paceFrames = 0;
  private paceSum = 0;
  private paced = false;

  private gustT = -1;
  private gustDur = 1.8;
  private gustNext = 1.4;
  private gustGain = 1;
  private readonly gust = new Float32Array(8); // p0, p1, p2, prev

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, reduced: boolean, cb: InkCallbacks) {
    this.canvas = canvas;
    this.gl = gl;
    this.reduced = reduced;
    this.cb = cb;
    for (let i = 0; i < DROPS; i++) this.drops[i * 4 + 3] = 1;
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
  }

  static create(canvas: HTMLCanvasElement, reduced: boolean, cb: InkCallbacks = {}): InkFluid | null {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return null;
    const ink = new InkFluid(canvas, gl, reduced, cb);
    try {
      if (!ink.init()) {
        ink.dispose();
        return null;
      }
    } catch {
      ink.dispose();
      return null;
    }
    return ink;
  }

  private init(): boolean {
    const gl = this.gl;
    this.formats = detectFormats(gl);
    if (!this.formats) return false;
    const mk = (frag: string) => createProgram(gl, S.VERT, frag);
    this.p = {
      splat: mk(S.SPLAT),
      curl: mk(S.CURL),
      force: mk(S.FORCE),
      divergence: mk(S.DIVERGENCE),
      scale: mk(S.SCALE),
      jacobi: mk(S.JACOBI),
      gradient: mk(S.GRADIENT),
      advect: mk(S.ADVECT),
      memory: mk(S.MEMORY),
      wash: mk(S.WASH),
      paper: mk(S.PAPER),
      display: mk(S.DISPLAY),
    };
    this.quad = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    const emptyRect = (): StampState => ({
      tex: blankStamp(gl),
      rect: new Float32Array([0, 0, 1, 1]),
      size: new Float32Array([1, 1]),
      source: null,
      css: { x: 0, y: 0, w: 0, h: 0 },
    });
    const prevName = this.name;
    this.name = emptyRect();
    this.msg = emptyRect();
    if (this.cssW > 1) this.buildTargets();
    if (prevName?.source) this.place(this.name, prevName.source, prevName.css);
    return true;
  }

  private buildTargets() {
    const gl = this.gl;
    const f = this.formats;
    if (!f) return;
    this.freeTargets();
    const w = this.canvas.width;
    const h = this.canvas.height;
    const short = Math.min(this.cssW, this.cssH);
    const sim = SIM_SHORT / short;
    this.simW = Math.max(8, Math.round(this.cssW * sim));
    this.simH = Math.max(8, Math.round(this.cssH * sim));
    this.simTexel[0] = 1 / this.simW;
    this.simTexel[1] = 1 / this.simH;
    const dispScale = Math.min(0.5, 1280 / Math.max(this.cssW, this.cssH));
    const washScale = Math.min(0.36, 900 / Math.max(this.cssW, this.cssH));
    const dw = Math.max(8, Math.round(this.cssW * dispScale));
    const dh = Math.max(8, Math.round(this.cssH * dispScale));
    const ww = Math.max(8, Math.round(this.cssW * washScale));
    const wh = Math.max(8, Math.round(this.cssH * washScale));
    this.t = {
      vel: createDouble(gl, this.simW, this.simH, f.rg, f.type),
      pressure: createDouble(gl, this.simW, this.simH, f.r, f.type),
      div: createTarget(gl, this.simW, this.simH, f.r, f.type),
      curl: createTarget(gl, this.simW, this.simH, f.r, f.type),
      disp: createDouble(gl, dw, dh, f.rgba, f.type),
      wash: createDouble(gl, ww, wh, f.r, f.type),
      paper: createTarget(gl, w, h, { internal: gl.RGBA8, format: gl.RGBA }, gl.UNSIGNED_BYTE),
    };
    this.renderPaper();
  }

  private freeTargets() {
    const t = this.t;
    if (!t) return;
    const gl = this.gl;
    for (const d of [t.vel, t.pressure, t.disp, t.wash]) {
      deleteTarget(gl, d.read);
      deleteTarget(gl, d.write);
    }
    deleteTarget(gl, t.div);
    deleteTarget(gl, t.curl);
    deleteTarget(gl, t.paper);
    this.t = null;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr;
    this.aspect = this.cssW / this.cssH;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.px[0] = 1 / w;
    this.px[1] = 1 / h;
    if (this.lost) return;
    this.buildTargets();
  }

  /** Places a glyph stamp (canvas already rasterised at `scale`) at a CSS-pixel rect. */
  private place(s: StampState, source: HTMLCanvasElement, css: Rect) {
    uploadStamp(this.gl, s.tex, source);
    s.source = source;
    s.css = { ...css };
    s.rect[0] = css.x / this.cssW;
    s.rect[1] = 1 - (css.y + css.h) / this.cssH;
    s.rect[2] = css.w / this.cssW;
    s.rect[3] = css.h / this.cssH;
    s.size[0] = source.width;
    s.size[1] = source.height;
  }

  /** `size` is the heading's font size; small type gets a finer bleed. */
  setName(source: HTMLCanvasElement, css: Rect, size = 100) {
    this.bleed = Math.min(1.4, Math.max(0.5, size / 75));
    if (!this.name || this.lost) return;
    this.place(this.name, source, css);
  }

  /** Pointer motion: `dx, dy` is the CSS-pixel travel since the last event. */
  stir(x: number, y: number, dx: number, dy: number, gain = 1) {
    this.lastInput = this.time;
    const r = this.stirRadius();
    const raw = Math.hypot(dx, dy);
    if (raw > 140) {
      dx *= 140 / raw;
      dy *= 140 / raw;
    }
    const len = Math.min(raw, 140);
    const n = Math.min(8, Math.max(1, Math.ceil(len / (r * 0.5))));
    // slow drifts barely bend the letters; a real flick marbles them
    const eager = len / (len + 18);
    const k = (this.reduced ? 0.3 : 1) * gain * 8.5 * eager * (this.simH / this.cssH);
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      this.pushForce(x - dx * (1 - f), y - dy * (1 - f), (dx / n) * k, (-dy / n) * k, r);
    }
  }

  private stirRadius() {
    return Math.min(90, Math.max(26, Math.min(this.cssW, this.cssH) * 0.065));
  }

  private pushForce(x: number, y: number, fx: number, fy: number, rPx: number) {
    if (this.nForces >= MAX_FORCES) return;
    const o = this.nForces * 5;
    this.forces[o] = x / this.cssW;
    this.forces[o + 1] = 1 - y / this.cssH;
    this.forces[o + 2] = fx;
    this.forces[o + 3] = fy;
    this.forces[o + 4] = (rPx / this.cssH) ** 2;
    this.nForces++;
  }

  private pushWash(x: number, y: number, amount: number, rPx: number) {
    if (this.nWashes >= MAX_WASH) return;
    const o = this.nWashes * 4;
    this.washes[o] = x / this.cssW;
    this.washes[o + 1] = 1 - y / this.cssH;
    this.washes[o + 2] = amount;
    this.washes[o + 3] = (rPx / this.cssH) ** 2;
    this.nWashes++;
  }

  /** A drop of clear water: parts the ink outward, then the map pulls it home. */
  drop(x: number, y: number, strength = 1) {
    this.lastInput = this.time;
    const i = this.dropNext;
    this.dropNext = (i + 1) % DROPS;
    const o = i * 4;
    const rPx = Math.min(70, Math.max(18, Math.min(this.cssW, this.cssH) * 0.035));
    this.drops[o] = x / this.cssW;
    this.drops[o + 1] = 1 - y / this.cssH;
    this.drops[o + 3] = (rPx / this.cssH) ** 2;
    this.dropPeak[i] = strength * (this.reduced ? 18 : 44);
    this.dropAge[i] = 0;
  }

  /** A bead of ink leaking from the pen while typing. */
  leak(x: number, y: number) {
    if (Math.random() < 0.35) return;
    this.pushWash(x + (Math.random() - 0.5) * 3, y + Math.random() * 2, 0.18 + Math.random() * 0.22, 2.2);
    this.drop(x, y, 0.08);
  }

  /** The sent message becomes ink and is carried off. */
  release(source: HTMLCanvasElement, css: Rect) {
    if (!this.msg || this.lost) return;
    this.lastInput = this.time;
    this.place(this.msg, source, css);
    this.msgAlpha = 1;
    this.msgReset = true;
    this.liftLeft = LIFT_TIME;
    this.shredAt = this.reduced ? -1 : this.time + 0.22;
  }

  /** A little vortex street: neighbouring eddies turn opposite ways and shred the line. */
  private shred() {
    const msg = this.msg;
    if (!msg) return;
    const css = msg.css;
    const cx = css.x + css.w / 2;
    const cy = css.y + css.h / 2;
    const line = css.h / 2.6;
    const span = Math.max(line, css.w - line * 1.6);
    const n = Math.max(2, Math.min(14, Math.round(span / (line * 1.5))));
    const spin = this.reduced ? 3 : 15;
    const lift = this.reduced ? 3 : 9;
    const gap = span / n;
    for (let i = 0; i < n; i++) {
      const x = cx - span / 2 + gap * (i + 0.5 + (Math.random() - 0.5) * 0.6);
      const s = (i % 2 === 0 ? 1 : -1) * (0.5 + Math.random() * 0.8);
      const up = lift * (0.4 + Math.random() * 1.2);
      const r = line * (0.55 + Math.random() * 0.4);
      this.pushForce(x, cy - line * 0.45, s * spin, up, r);
      this.pushForce(x, cy + line * 0.45, -s * spin, up, r);
    }
  }

  start() {
    if (this.running || this.lost) return;
    this.running = true;
    this.paceFrames = 0;
    this.paceSum = 0;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    const dt = Math.min(Math.max(raw, 0), 1 / 30);
    this.last = now;
    if (dt <= 0) return;
    this.watchPace(raw);
    this.time += dt;
    this.step(dt);
    this.render();
    if (!this.drawn) {
      this.drawn = true;
      this.cb.onFirstFrame?.();
    }
  };

  /** If the first couple of seconds run under ~40fps, ask once for a lighter canvas. */
  private watchPace(raw: number) {
    if (this.paced || raw > 0.25) return;
    this.paceFrames++;
    this.paceSum += raw;
    if (this.paceFrames < 90) return;
    this.paced = true;
    if (this.paceSum / this.paceFrames > 1 / 40) this.cb.onSlow?.();
  }

  private updateGust(dt: number) {
    if (this.reduced || !this.name?.source) return;
    const g = this.gust;
    if (this.gustT < 0) {
      if (this.time < this.gustNext) return;
      if (this.time - this.lastInput < 5) {
        this.gustNext = this.time + 3;
        return;
      }
      const n = this.name.css;
      if (this.time > 5 && Math.random() < 0.4) {
        // sometimes a single drop of water lands on a letter instead
        const lastInput = this.lastInput;
        this.drop(n.x + n.w * (0.15 + Math.random() * 0.7), n.y + n.h * (0.35 + Math.random() * 0.3), 0.75);
        this.lastInput = lastInput;
        this.gustNext = this.time + 7 + Math.random() * 5;
        return;
      }
      const fromLeft = Math.random() < 0.5;
      const dir = fromLeft ? 1 : -1;
      const edge = fromLeft ? n.x : n.x + n.w;
      const y0 = n.y + n.h * (0.2 + Math.random() * 0.6);
      g[0] = edge - dir * n.h * 0.9;
      g[1] = y0 + (Math.random() - 0.5) * n.h;
      g[2] = edge + dir * n.w * (0.18 + Math.random() * 0.25);
      g[3] = y0 + (Math.random() - 0.5) * n.h * 1.6;
      g[4] = edge + dir * n.w * (0.3 + Math.random() * 0.35);
      g[5] = y0 + (Math.random() - 0.5) * n.h * 2.2;
      g[6] = g[0];
      g[7] = g[1];
      this.gustT = 0;
      this.gustDur = 1.6 + Math.random() * 0.8;
      // the first pass after load is the teaser; later ones are barely a breath
      this.gustGain = this.time < 5 ? 1.7 : 1 + Math.random() * 0.6;
      return;
    }
    this.gustT += dt;
    const u = Math.min(1, this.gustT / this.gustDur);
    const e = u * u * (3 - 2 * u);
    const a = (1 - e) * (1 - e);
    const b = 2 * (1 - e) * e;
    const c = e * e;
    const x = a * g[0] + b * g[2] + c * g[4];
    const y = a * g[1] + b * g[3] + c * g[5];
    const lastInput = this.lastInput;
    this.stir(x, y, x - g[6], y - g[7], this.gustGain * Math.sin(Math.PI * u));
    this.lastInput = lastInput;
    g[6] = x;
    g[7] = y;
    if (u >= 1) {
      this.gustT = -1;
      this.gustNext = this.time + 9 + Math.random() * 6;
    }
  }

  private bind(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    return unit;
  }

  private draw(target: Target | null) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private use(prog: Program) {
    this.gl.useProgram(prog.program);
    return prog.u;
  }

  private splat(target: DoubleTarget, x: number, y: number, r: number, v0: number, v1: number) {
    const gl = this.gl;
    const p = this.p;
    if (!p) return;
    const u = this.use(p.splat);
    gl.uniform1i(u.uBase, this.bind(0, target.read.tex));
    gl.uniform2f(u.uPoint, x, y);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform1f(u.uRadius, r);
    gl.uniform4f(u.uValue, v0, v1, 0, 0);
    this.draw(target.write);
    target.swap();
  }

  private renderPaper() {
    const gl = this.gl;
    const p = this.p;
    const t = this.t;
    if (!p || !t) return;
    const u = this.use(p.paper);
    gl.uniform1f(u.uScale, this.dpr);
    this.draw(t.paper);
  }

  private step(dt: number) {
    const gl = this.gl;
    const p = this.p;
    const t = this.t;
    const name = this.name;
    const msg = this.msg;
    if (!p || !t || !name || !msg) return;

    this.updateGust(dt);

    for (let i = 0; i < this.nForces; i++) {
      const o = i * 5;
      const f = this.forces;
      this.splat(t.vel, f[o], f[o + 1], f[o + 4], f[o + 2], f[o + 3]);
    }
    this.nForces = 0;
    for (let i = 0; i < this.nWashes; i++) {
      const o = i * 4;
      const w = this.washes;
      this.splat(t.wash, w[o], w[o + 1], w[o + 3], w[o + 2], 0);
    }
    this.nWashes = 0;

    if (this.shredAt >= 0 && this.time >= this.shredAt) {
      this.shredAt = -1;
      this.shred();
    }
    if (this.liftLeft > 0) {
      this.liftLeft -= dt;
      const c = msg.css;
      const lift = (this.reduced ? 8 : 16) * dt;
      const y = c.y + c.h * 0.5 - (LIFT_TIME - this.liftLeft) * 30;
      for (let i = 0; i < 3; i++) {
        this.pushForce(c.x + c.w * (0.2 + 0.3 * i), y, 0, lift * (i === 1 ? 0.8 : 1), c.h * 0.9);
      }
    }

    for (let i = 0; i < DROPS; i++) {
      this.dropAge[i] += dt;
      this.drops[i * 4 + 2] = this.dropPeak[i] * Math.exp(-this.dropAge[i] / 0.11);
    }

    let u = this.use(p.curl);
    gl.uniform1i(u.uVel, this.bind(0, t.vel.read.tex));
    gl.uniform2fv(u.uTexel, this.simTexel);
    this.draw(t.curl);

    u = this.use(p.force);
    gl.uniform1i(u.uVel, this.bind(0, t.vel.read.tex));
    gl.uniform1i(u.uCurl, this.bind(1, t.curl.tex));
    gl.uniform2fv(u.uTexel, this.simTexel);
    gl.uniform1f(u.uCurlStrength, this.reduced ? 3 : 8);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uIdle, this.reduced ? 0.05 : 0.22);
    gl.uniform1f(u.uAspect, this.aspect);
    this.draw(t.vel.write);
    t.vel.swap();

    u = this.use(p.divergence);
    gl.uniform1i(u.uVel, this.bind(0, t.vel.read.tex));
    gl.uniform2fv(u.uTexel, this.simTexel);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform4fv(u.uDrops, this.drops);
    this.draw(t.div);

    u = this.use(p.scale);
    gl.uniform1i(u.uTex, this.bind(0, t.pressure.read.tex));
    gl.uniform1f(u.uValue, 0.8);
    this.draw(t.pressure.write);
    t.pressure.swap();

    u = this.use(p.jacobi);
    gl.uniform1i(u.uDiv, this.bind(1, t.div.tex));
    gl.uniform2fv(u.uTexel, this.simTexel);
    for (let i = 0; i < PRESSURE_ITERS; i++) {
      gl.uniform1i(u.uPressure, this.bind(0, t.pressure.read.tex));
      this.draw(t.pressure.write);
      t.pressure.swap();
    }

    u = this.use(p.gradient);
    gl.uniform1i(u.uPressure, this.bind(0, t.pressure.read.tex));
    gl.uniform1i(u.uVel, this.bind(1, t.vel.read.tex));
    gl.uniform2fv(u.uTexel, this.simTexel);
    this.draw(t.vel.write);
    t.vel.swap();

    u = this.use(p.advect);
    gl.uniform1i(u.uVel, this.bind(0, t.vel.read.tex));
    gl.uniform1i(u.uSrc, 0);
    gl.uniform2fv(u.uTexel, this.simTexel);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uKeep, Math.exp(-dt * (this.reduced ? 2.2 : 1.1)));
    this.draw(t.vel.write);
    t.vel.swap();

    u = this.use(p.memory);
    gl.uniform1i(u.uVel, this.bind(0, t.vel.read.tex));
    gl.uniform1i(u.uDisp, this.bind(1, t.disp.read.tex));
    gl.uniform2fv(u.uTexel, this.simTexel);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uCalm, this.reduced ? 2.2 : 1.05);
    gl.uniform1f(u.uActive, this.reduced ? 0.8 : 0.12);
    gl.uniform1f(u.uMsgKeep, this.msgReset ? 0 : 1);
    this.msgReset = false;
    this.draw(t.disp.write);
    t.disp.swap();

    this.msgAlpha *= Math.exp(-dt * (this.reduced ? 0.9 : 0.42));
    if (this.msgAlpha < 0.004) this.msgAlpha = 0;

    u = this.use(p.wash);
    gl.uniform1i(u.uVel, this.bind(0, t.vel.read.tex));
    gl.uniform1i(u.uWash, this.bind(1, t.wash.read.tex));
    gl.uniform1i(u.uDisp, this.bind(2, t.disp.read.tex));
    gl.uniform1i(u.uName, this.bind(3, name.tex));
    gl.uniform1i(u.uMsg, this.bind(4, msg.tex));
    gl.uniform4fv(u.uNameRect, name.rect);
    gl.uniform4fv(u.uMsgRect, msg.rect);
    gl.uniform1f(u.uNameLod, Math.max(0, Math.log2(name.size[0] / Math.max(1, name.rect[2] * t.wash.read.w))));
    gl.uniform1f(u.uMsgLod, Math.max(0, Math.log2(msg.size[0] / Math.max(1, msg.rect[2] * t.wash.read.w))));
    gl.uniform1f(u.uMsgAlpha, this.msgAlpha);
    gl.uniform2fv(u.uTexel, this.simTexel);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uKeep, Math.exp(-dt * 0.5));
    gl.uniform1f(u.uShed, this.reduced ? 0.15 : 0.45);
    this.draw(t.wash.write);
    t.wash.swap();
  }

  private render() {
    const gl = this.gl;
    const p = this.p;
    const t = this.t;
    const name = this.name;
    const msg = this.msg;
    if (!p || !t || !name || !msg) return;
    const u = this.use(p.display);
    gl.uniform1i(u.uDisp, this.bind(0, t.disp.read.tex));
    gl.uniform1i(u.uWash, this.bind(1, t.wash.read.tex));
    gl.uniform1i(u.uPaper, this.bind(2, t.paper.tex));
    gl.uniform1i(u.uName, this.bind(3, name.tex));
    gl.uniform1i(u.uMsg, this.bind(4, msg.tex));
    gl.uniform4fv(u.uNameRect, name.rect);
    gl.uniform4fv(u.uMsgRect, msg.rect);
    gl.uniform2fv(u.uNameSize, name.size);
    gl.uniform1f(u.uMsgAlpha, this.msgAlpha);
    gl.uniform2fv(u.uPx, this.px);
    gl.uniform2f(u.uDispTexel, 1 / t.disp.read.w, 1 / t.disp.read.h);
    gl.uniform1f(u.uBleed, this.bleed * this.dpr);
    gl.uniform3f(u.uPaperCol, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform3f(u.uInkCol, INK[0], INK[1], INK[2]);
    this.draw(null);
  }

  private readonly handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.stop();
    this.cb.onLost?.();
  };

  private readonly handleRestored = () => {
    this.lost = false;
    this.p = null;
    this.t = null;
    try {
      if (!this.init()) return;
    } catch {
      return;
    }
    this.drawn = false;
    this.start();
  };

  private freeStamp(s: StampState | null) {
    if (s) this.gl.deleteTexture(s.tex);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.freeTargets();
    this.freeStamp(this.name);
    this.freeStamp(this.msg);
    if (this.p) for (const prog of Object.values(this.p)) gl.deleteProgram(prog.program);
    if (this.quad) gl.deleteBuffer(this.quad);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.p = null;
  }
}
