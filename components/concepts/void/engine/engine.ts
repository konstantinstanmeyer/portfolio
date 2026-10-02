import { GlyphAtlas } from "./atlas";
import { BASE, CARET_CELL, FONT_WEIGHT, HEAT_REST, MID, OPTICAL_Y, STRIDE } from "./constants";
import { bezier, DYING, easeInOut, FLYING, type Glyph, makeGlyph } from "./glyph";
import { type Frame, hitTest, type Layout, layoutText, type Metrics } from "./layout";
import { NameGlow } from "./name-glow";
import { type DrawList, Renderer } from "./renderer";

export interface VoidElements {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
  name: HTMLElement[];
}

export interface VoidHandle {
  /** Enter was pressed: the letters draw breath while the message is in flight. */
  commit(): void;
  /** The server accepted it: the letters carry their heat into the name. */
  depart(): void;
  /** The server refused it: the letters shiver and stay. */
  reject(): void;
  setPending(pending: boolean): void;
  dispose(): void;
}

const TAU = Math.PI * 2;

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const MAX_STAMPS = 6000;

function segmenter(): (s: string) => string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return (s) => Array.from(seg.segment(s), (x) => x.segment);
  }
  return (s) => Array.from(s);
}

function fontFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  return v ? `${v}, system-ui, sans-serif` : "system-ui, sans-serif";
}

class Engine implements VoidHandle {
  private readonly renderer: Renderer;
  private readonly atlas: GlyphAtlas;
  private readonly name: NameGlow;
  private readonly split = segmenter();
  private readonly off: (() => void)[] = [];
  private readonly family = fontFamily();

  private chars: string[] = [];
  private glyphs: Glyph[] = [];
  private dying: Glyph[] = [];
  private flying: Glyph[] = [];
  private readonly caret: Glyph;
  private metrics: Metrics = { adv: [], kern: [], space: [] };
  private lay!: Layout;
  private frame: Frame = { cx: 0, cy: 0, s0: 64, sMin: 24, maxW: 100, maxH: 100 };

  private w = 1;
  private h = 1;
  private cursor = 0;
  private selA = 0;
  private selB = 0;
  private focused = false;
  private pending = false;
  private reduced = false;
  private coarse = false;
  private seed = 1;

  private px = -1e4;
  private py = -1e4;
  private pvx = 0;
  private pvy = 0;
  private pt = 0;
  private pointerKind = "mouse";

  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private lost = false;
  private frames = 0;
  private blinkT0 = 0;
  private caretPower = 1;
  private caretHold = 0;
  private shakeT = -10;
  private trailTimer = 0;
  private anchorX = -1;
  private anchorY = -1;
  private anchorShown = false;
  private buttonDisabled = true;
  private disposed = false;

  private glyphData = new Float32Array(256 * STRIDE);
  private stampData = new Float32Array(MAX_STAMPS * STRIDE);
  private readonly drawList: DrawList = {
    glyphs: this.glyphData,
    glyphCount: 0,
    stamps: this.stampData,
    stampCount: 0,
    trail: false,
    decay: 1,
  };

  constructor(private readonly els: VoidElements) {
    this.renderer = new Renderer(els.canvas);
    this.atlas = new GlyphAtlas(this.family, (cell, px) => this.renderer.uploadCell(cell, px));
    this.name = new NameGlow(els.name);
    this.caret = makeGlyph("", CARET_CELL, 0, 0);
    this.caret.heat = 0.5;

    const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
    const mqCoarse = matchMedia("(pointer: coarse)");
    this.reduced = mqReduce.matches;
    this.coarse = mqCoarse.matches;
    this.listen(mqReduce, "change", () => (this.reduced = mqReduce.matches));
    this.listen(mqCoarse, "change", () => (this.coarse = mqCoarse.matches));

    const { stage, input, canvas } = els;
    this.listen(input, "input", () => this.syncText());
    this.listen(input, "focus", () => {
      this.focused = true;
      this.blinkT0 = this.time;
      this.reframe();
    });
    this.listen(input, "blur", () => {
      this.focused = false;
      this.reframe();
    });
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent), true);
    this.listen(stage, "pointermove", (e) => this.onMove(e as PointerEvent));
    this.listen(stage, "pointerdown", (e) => this.onDown(e as PointerEvent));
    this.listen(stage, "click", (e) => this.onClick(e as MouseEvent));
    this.listen(stage, "mousedown", (e) => {
      // Keep focus on the field: clicking the void never blurs it.
      if ((e as MouseEvent).button === 0 && !this.els.button.contains(e.target as Node)) e.preventDefault();
    });
    this.listen(stage, "pointerleave", () => {
      this.px = -1e4;
      this.py = -1e4;
    });
    this.listen(document, "visibilitychange", () => (document.hidden ? this.stop() : this.start()));
    this.listen(canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.listen(canvas, "webglcontextrestored", () => {
      this.renderer.init();
      this.atlas.replay();
      this.lost = false;
      this.resize();
    });
    const vv = window.visualViewport;
    if (vv) this.listen(vv, "resize", () => this.reframe());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(stage);
    this.off.push(() => ro.disconnect());

    this.resize();
    this.syncText();
    this.start();

    // Rebake once the webfont is really there (first bakes may use a fallback).
    const probe = `${FONT_WEIGHT} ${BASE}px ${this.family}`;
    document.fonts
      .load(probe)
      .then(() => {
        if (this.disposed) return;
        this.atlas.setFamily(this.family);
        this.rebind();
        this.name.measure(this.els.stage.getBoundingClientRect());
      })
      .catch(() => undefined);
  }

  // —— public ——————————————————————————————————————————————

  commit() {
    this.setPending(true);
  }

  setPending(p: boolean) {
    this.pending = p;
    this.els.input.readOnly = p;
    this.updateButton();
  }

  depart() {
    this.setPending(false);
    const live = this.glyphs;
    const flyers: Glyph[] = [];
    for (const g of live) {
      if (g.space) continue;
      if (g.hidden || g.age < 0) {
        g.phase = DYING;
        this.dying.push(g);
      } else flyers.push(g);
    }
    const n = flyers.length;
    const stagger = Math.min(0.055, Math.max(0.016, 0.9 / Math.max(1, n)));
    const nameSize = this.name.fontSize.value;
    for (let k = 0; k < n; k++) {
      const g = flyers[k];
      const target = this.name.targetFor(k, n);
      g.target = target;
      g.delay = k * stagger;
      g.t = 0;
      g.delivered = false;
      if (this.reduced) {
        g.phase = DYING;
        this.dying.push(g);
        continue;
      }
      g.phase = FLYING;
      const x3 = this.name.tx[target];
      const y3 = this.name.ty[target];
      const lift = g.size * (0.55 + 0.75 * (n > 1 ? k / (n - 1) : 0.5)) + g.size * 0.2 * this.rand();
      g.p0x = g.x;
      g.p0y = g.y;
      g.p1x = g.x + (x3 - g.x) * 0.04;
      g.p1y = g.y - lift;
      g.p2x = x3 + (g.x - x3) * (0.22 + 0.12 * this.rand());
      g.p2y = y3 - (y3 - g.y) * (0.55 + 0.2 * this.rand());
      g.p3x = x3;
      g.p3y = y3;
      g.s0 = g.size;
      g.s1 = nameSize;
      g.dur = 1.35 + 0.25 * this.rand();
      g.lx = g.x;
      g.ly = g.y;
      g.ls = g.size;
      g.lh = g.heat;
      this.flying.push(g);
    }
    this.glyphs = [];
    this.chars = [];
    this.cursor = this.selA = this.selB = 0;
    this.caretPower = 0;
    this.caret.heat = 0;
    // In reduced motion the words cool where they stand, so wait for them.
    this.caretHold = this.time + (this.reduced ? Math.min(2.8, n * stagger + 1.7) : Math.min(1.6, n * stagger + 0.7));
    this.relayout();
    this.caret.x = this.lay.caretX;
    this.caret.y = this.lay.caretY;
    this.caret.size = this.lay.size;
  }

  reject() {
    this.setPending(false);
    this.shakeT = this.time;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    for (const f of this.off) f();
    this.name.reset();
    this.renderer.dispose();
  }

  // —— input ——————————————————————————————————————————————

  private listen(t: EventTarget, type: string, fn: (e: Event) => void, capture = false) {
    t.addEventListener(type, fn, capture);
    this.off.push(() => t.removeEventListener(type, fn, capture));
  }

  private rand() {
    // Deterministic, allocation-free jitter.
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private onKey(e: KeyboardEvent) {
    const { input, button } = this.els;
    if (e.defaultPrevented || e.isComposing) return;
    if (document.activeElement === input) {
      if (e.key === "Escape") input.blur();
      this.blinkT0 = this.time;
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1 && e.key !== "Backspace") return;
    if (document.activeElement === button && e.key === " ") return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  private onMove(e: PointerEvent) {
    this.pointerKind = e.pointerType;
    const r = this.els.stage.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const now = e.timeStamp / 1000;
    const dt = now - this.pt;
    if (this.px > -1e3 && dt > 0.001 && dt < 0.2) {
      const clampV = (v: number) => Math.max(-5000, Math.min(5000, v));
      this.pvx += (clampV((x - this.px) / dt) - this.pvx) * 0.5;
      this.pvy += (clampV((y - this.py) / dt) - this.pvy) * 0.5;
    }
    this.px = x;
    this.py = y;
    this.pt = now;
  }

  private onDown(e: PointerEvent) {
    this.pointerKind = e.pointerType;
    this.onMove(e);
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if (this.els.button.contains(e.target as Node)) return;
    e.preventDefault();
    this.focusAt(e.clientX, e.clientY);
  }

  private onClick(e: MouseEvent) {
    if (this.pointerKind === "mouse") return;
    if (this.els.button.contains(e.target as Node)) return;
    this.focusAt(e.clientX, e.clientY);
  }

  private focusAt(cx: number, cy: number) {
    const { input } = this.els;
    const r = this.els.stage.getBoundingClientRect();
    const idx = hitTest(this.lay, this.metrics, cx - r.left, cy - r.top);
    input.focus({ preventScroll: true });
    const pos = idx < 0 ? input.value.length : this.offsetOf(idx);
    input.setSelectionRange(pos, pos);
    this.blinkT0 = this.time;
  }

  private offsetOf(graphemeIndex: number) {
    let o = 0;
    for (let i = 0; i < graphemeIndex && i < this.chars.length; i++) o += this.chars[i].length;
    return o;
  }

  private graphemeAt(offset: number) {
    let o = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (o >= offset) return i;
      o += this.chars[i].length;
    }
    return this.chars.length;
  }

  private readSelection(): boolean {
    const { input } = this.els;
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? s;
    const a = this.graphemeAt(s);
    const b = this.graphemeAt(e);
    const c = input.selectionDirection === "backward" ? a : b;
    if (a === this.selA && b === this.selB && c === this.cursor) return false;
    this.selA = a;
    this.selB = b;
    this.cursor = c;
    return true;
  }

  // —— text ——————————————————————————————————————————————

  private syncText() {
    const next = this.split(this.els.input.value);
    const prev = this.chars;
    let p = 0;
    while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
    let s = 0;
    while (s < prev.length - p && s < next.length - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;

    const removed = this.glyphs.splice(p, prev.length - p - s);
    for (const g of removed) {
      g.phase = DYING;
      g.target = -1;
      g.delay = 0;
      g.t = 0;
      if (!g.space) this.dying.push(g);
    }
    const born: Glyph[] = [];
    for (let i = p; i < next.length - s; i++) born.push(this.spawn(next[i]));
    this.glyphs.splice(p, 0, ...born);
    this.chars = next;
    if (this.atlas.full) this.rebind();
    this.readSelection();
    this.relayout();

    // New letters appear beside their current neighbours, then fall onto the line.
    const anchor = this.glyphs[p - 1] ?? this.glyphs[p + born.length];
    const ox = anchor ? anchor.x - anchor.tx : 0;
    for (let k = 0; k < born.length; k++) {
      const g = born[k];
      g.size = g.ts;
      g.x = g.tx + ox;
      g.y = this.reduced ? g.ty : g.ty - 0.34 * g.ts;
      g.airborne = !this.reduced;
      g.age = -Math.min(k * 0.012, 0.6);
      g.alpha = 0;
      g.refl = g.reflT;
      g.floor = this.lay.floor;
    }
    this.blinkT0 = this.time;
    this.updateButton();
  }

  private spawn(ch: string): Glyph {
    const blank = ch.trim() === "";
    const cell = blank ? -1 : this.atlas.cellFor(ch);
    return makeGlyph(ch, blank ? -1 : Math.max(cell, 0), this.atlas.advance(blank ? " " : ch), this.rand());
  }

  /** After the atlas was rebuilt, re-point live glyphs at their new cells. */
  private rebind() {
    if (this.atlas.full) this.atlas.setFamily(this.family);
    for (const g of this.glyphs) {
      if (g.space) continue;
      g.cell = Math.max(0, this.atlas.cellFor(g.ch));
      g.adv = this.atlas.advance(g.ch);
    }
    for (const g of this.flying) g.cell = Math.max(0, this.atlas.cellFor(g.ch));
    for (const g of this.dying) g.cell = Math.max(0, this.atlas.cellFor(g.ch));
    this.relayout();
  }

  private relayout() {
    const n = this.chars.length;
    const m = this.metrics;
    m.adv.length = n;
    m.kern.length = n;
    m.space.length = n;
    for (let i = 0; i < n; i++) {
      const g = this.glyphs[i];
      m.adv[i] = g.adv;
      m.space[i] = g.space;
      m.kern[i] = i > 0 ? this.atlas.kern(this.chars[i - 1], this.chars[i]) : 0;
    }
    const l = layoutText(m, this.cursor, this.frame);
    this.lay = l;
    for (let i = 0; i < n; i++) {
      const g = this.glyphs[i];
      g.tx = l.x[i];
      g.ty = l.y[i];
      g.ts = l.size;
      g.hidden = l.hidden[i];
      g.fade = l.fade[i];
      g.reflT = l.line[i] === l.lastLine ? 1 : 0;
      g.floor = l.floor;
    }
    this.updateButton();
  }

  private updateButton() {
    const { button } = this.els;
    let empty = true;
    for (const c of this.chars) if (c.trim()) empty = false;
    const disabled = empty || this.pending;
    if (disabled !== this.buttonDisabled) {
      this.buttonDisabled = disabled;
      button.disabled = disabled;
    }
    const show = !empty && !this.pending;
    if (show !== this.anchorShown) {
      this.anchorShown = show;
      button.dataset.show = show ? "1" : "0";
    }
  }

  // —— frame ——————————————————————————————————————————————

  private resize() {
    const r = this.els.stage.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(this.w, this.h, dpr);
    this.reframe();
    this.name.measure(r);
    if (this.frames === 0) {
      this.caret.x = this.lay.caretX;
      this.caret.y = this.lay.caretY;
      this.caret.size = this.lay.size;
    }
  }

  /** Text frame: size, optical centre, measure. On phones it follows the keyboard. */
  private reframe() {
    const s0 = Math.max(40, Math.min(128, Math.min(this.w * 0.1, this.h * 0.12)));
    const gutter = Math.max(20, this.w * 0.07);
    let cy = this.h * OPTICAL_Y;
    const vv = window.visualViewport;
    if (vv && this.coarse && this.focused && vv.height < this.h * 0.85) {
      cy = vv.offsetTop + vv.height * 0.42;
    }
    this.frame = {
      cx: this.w / 2,
      cy,
      s0,
      sMin: Math.min(s0, this.w < 600 ? 22 : 28),
      maxW: this.w - gutter * 2,
      maxH: Math.max(s0 * 1.2, this.h * 0.5),
    };
    this.relayout();
  }

  private start() {
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(1 / 30, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.focused && this.readSelection()) {
      this.relayout();
      this.blinkT0 = this.time;
    }
    this.step(dt);
    if (!this.lost) this.draw(dt);
    if (++this.frames === 2) this.els.stage.dataset.gl = "1";
  };

  private step(dt: number) {
    const decay = Math.exp(-dt * 6);
    this.pvx *= decay;
    this.pvy *= decay;

    let light = 0;
    const glyphs = this.glyphs;
    // A refused message: the line shivers and the power sags, then recovers.
    const shake = this.time - this.shakeT;
    const shakeEnv = shake < 0.8 ? Math.exp(-shake * 5) : 0;
    const shakeX = shakeEnv * Math.sin(shake * TAU * 7) * Math.max(0.09 * this.lay.size, 9);
    const sag = shake < 2 ? Math.exp(-shake * 2.2) : 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const sel = this.selA !== this.selB && i >= this.selA && i < this.selB;
      this.stepLive(g, dt, shakeX, sag, sel);
      if (!g.space) light += g.heat * g.alpha * (g.size / this.frame.s0);
    }
    this.stepCaret(dt);

    const dying = this.dying;
    let w = 0;
    for (let i = 0; i < dying.length; i++) {
      const g = dying[i];
      if (this.stepDying(g, dt)) dying[w++] = g;
    }
    dying.length = w;

    const flying = this.flying;
    w = 0;
    for (let i = 0; i < flying.length; i++) {
      const g = flying[i];
      if (this.stepFlying(g, dt)) flying[w++] = g;
      const dx = g.x - this.name.tx[g.target];
      const dy = g.y - this.name.ty[g.target];
      light += g.heat * g.alpha * 2.5 * Math.exp(-(dx * dx + dy * dy) / 60000);
    }
    flying.length = w;

    this.name.light = 1 - Math.exp(-light * 0.05);
    this.name.step(dt);
    this.name.apply();
    this.trailTimer = flying.length > 0 ? 2.5 : Math.max(0, this.trailTimer - dt);
    this.placeButton(dt);
  }

  private stepLive(g: Glyph, dt: number, shakeX: number, sag: number, selected: boolean) {
    g.age += dt;
    if (g.age < 0) return;
    const S = g.ts;
    const reduced = this.reduced;

    // Horizontal: a sprung slide as the line re-centres.
    const k = reduced ? 90 : 150;
    const c = reduced ? 2 * Math.sqrt(k) : 1.55 * Math.sqrt(k);
    const tx = g.tx + (reduced ? 0 : shakeX);
    g.vx += (k * (tx - g.x) - c * g.vx) * dt;
    g.x += g.vx * dt;

    // Vertical: letters have weight. They fall onto the line and bounce once.
    const ty = g.ty - (this.pending && !reduced ? 0.06 * S : 0);
    if (g.airborne) {
      g.vy += 53 * S * dt;
      g.y += g.vy * dt;
      if (g.y >= ty) {
        g.y = ty;
        if (g.vy > 1.4 * S) {
          g.flare += Math.min(0.22, g.vy / (S * 40));
          g.vy = -g.vy * 0.27;
        } else {
          g.vy = 0;
          g.airborne = false;
        }
      }
    } else if (!reduced && ty - g.y > 0.12 * S) {
      g.airborne = true;
    } else {
      const ky = reduced ? 80 : 170;
      g.vy += (ky * (ty - g.y) - 2 * Math.sqrt(ky) * g.vy) * dt;
      g.y += g.vy * dt;
    }
    g.size += (S - g.size) * (1 - Math.exp(-dt * 9));

    this.wind(g, dt);

    const age = g.age;
    const ignite = age < 1 ? 0.3 * Math.exp(-age / 0.16) : 0;
    const shimmer = 0.022 * Math.sin(this.time * 1.7 + g.seed * TAU) + 0.014 * Math.sin(this.time * 3.3 + g.seed * 40);
    // Words cool slowly while you think; breath (the pointer) rekindles them.
    const rest = HEAT_REST - 0.16 * (1 - Math.exp(-age / 6));
    let target = rest + shimmer + ignite + g.flare;
    if (this.pending) target += 0.16 + 0.05 * Math.sin(this.time * 9 + g.seed * 9);
    if (selected) target += 0.3;
    target -= 0.6 * sag;
    const rate = target > g.heat ? 16 : 4;
    g.heat += (target - g.heat) * (1 - Math.exp(-dt * rate));
    g.flare = Math.min(0.5, g.flare) * Math.exp(-dt * 1.1);
    g.alpha += ((g.hidden ? 0 : g.fade) - g.alpha) * (1 - Math.exp(-dt * 10));
    g.refl += (g.reflT - g.refl) * (1 - Math.exp(-dt * 6));
    g.floor += (this.lay.floor - g.floor) * (1 - Math.exp(-dt * 10));
  }

  /** Moving the pointer is like breathing on embers: letters sway and flare. */
  private wind(g: Glyph, dt: number) {
    const dx = g.x - this.px;
    const dy = g.y - MID * g.size - this.py;
    const r = g.size * 1.15 + 36;
    const fall = Math.exp(-(dx * dx + dy * dy) / (r * r));
    const speed = Math.abs(this.pvx) + Math.abs(this.pvy);
    g.flare += speed * fall * dt * (this.pointerKind === "mouse" ? 0.003 : 0.0055);
    const torque = this.reduced ? 0 : this.pvx * fall * 0.009;
    g.vr += (-95 * g.rot - 6.5 * g.vr + torque) * dt;
    g.rot = Math.max(-0.4, Math.min(0.4, g.rot + g.vr * dt));
  }

  private stepCaret(dt: number) {
    const c = this.caret;
    const l = this.lay;
    let tx = l.caretX;
    const k = this.cursor;
    if (k > 0 && k <= this.glyphs.length) {
      const g = this.glyphs[k - 1];
      if (g.age >= 0) tx = g.x + (g.adv * g.size) / 2 + 0.03 * g.size;
    } else if (k === 0 && this.glyphs.length > 0) {
      const g = this.glyphs[0];
      tx = g.x - (g.adv * g.size) / 2 - 0.06 * g.size;
    }
    const ks = 320;
    c.vx += (ks * (tx - c.x) - 2 * Math.sqrt(ks) * c.vx) * dt;
    c.x += c.vx * dt;
    c.vy += (ks * (l.caretY - c.y) - 2 * Math.sqrt(ks) * c.vy) * dt;
    c.y += c.vy * dt;
    c.size += (l.size - c.size) * (1 - Math.exp(-dt * 12));
    this.wind(c, dt);
    c.flare = Math.min(0.5, c.flare) * Math.exp(-dt * 1.7);

    let base: number;
    if (!this.focused) {
      // Unfocused: a banked ember, blinking slowly.
      const ph = (this.time / 1.8) % 1;
      base = this.reduced ? 0.62 : 0.64 - 0.18 * smooth(0.42, 0.62, ph) * (1 - smooth(0.86, 1, ph));
    } else if (this.reduced) {
      base = 0.88 + 0.08 * Math.sin(this.time * 1.8);
    } else {
      // The blink is a filament cooling to an ember and catching again.
      const ph = ((this.time - this.blinkT0) / 1.06) % 1;
      const offAmt = smooth(0.47, 0.6, ph) * (1 - smooth(0.9, 0.99, ph));
      base = 1.0 - 0.64 * offAmt;
    }
    if (this.selA !== this.selB || this.pending) base = 0;
    const want = this.time >= this.caretHold ? 1 : 0;
    this.caretPower += (want - this.caretPower) * (1 - Math.exp(-dt * (want ? 3 : 12)));
    const target = base * this.caretPower + c.flare;
    const rate = target > c.heat ? 18 : 9;
    c.heat += (target - c.heat) * (1 - Math.exp(-dt * rate));
    c.floor = l.floor;
    c.refl = 1;
    c.alpha = 1;
  }

  /** Deleted letters cool and sink. Returns false once gone. */
  private stepDying(g: Glyph, dt: number): boolean {
    g.t += dt;
    if (g.t < g.delay) return true;
    const cool = g.target >= 0 ? 1.1 : 3.2;
    g.heat -= dt * cool * Math.max(0.25, g.heat);
    if (!this.reduced && g.target < 0) {
      g.vy += 0.9 * g.size * dt;
      g.y += g.vy * dt;
    }
    g.refl *= Math.exp(-dt * 3);
    if (g.target >= 0 && !g.delivered && g.heat < 0.5) {
      g.delivered = true;
      this.name.deposit(g.target, 0.5);
    }
    return g.heat > 0.02;
  }

  /** Sent letters travel into the name. Returns false once absorbed. */
  private stepFlying(g: Glyph, dt: number): boolean {
    g.lx = g.x;
    g.ly = g.y;
    g.ls = g.size;
    g.lh = g.heat;
    g.t += dt;
    const u0 = (g.t - g.delay) / g.dur;
    if (u0 <= 0) {
      g.heat += (1.12 - g.heat) * (1 - Math.exp(-dt * 10));
      return true;
    }
    const u = Math.min(1, u0);
    const e = easeInOut(u);
    g.x = bezier(g.p0x, g.p1x, g.p2x, g.p3x, e);
    g.y = bezier(g.p0y, g.p1y, g.p2y, g.p3y, e);
    g.size = g.s0 * Math.pow(g.s1 / g.s0, Math.pow(e, 0.8));
    g.rot *= Math.exp(-dt * 6);
    g.heat = 1.02 + 0.28 * Math.sin(Math.PI * u);
    g.alpha = u > 0.9 ? Math.max(0, (1 - u) / 0.1) : 1;
    g.refl = Math.max(0, 1 - u * 6);
    if (u >= 1) {
      this.name.deposit(g.target, 1.05);
      return false;
    }
    return true;
  }

  private placeButton(dt: number) {
    const { button } = this.els;
    const l = this.lay;
    const S = l.size;
    const tx = Math.min(this.w - 30, l.endX + 0.5 * S);
    const ty = l.endY;
    if (this.anchorX < 0) {
      this.anchorX = tx;
      this.anchorY = ty;
    }
    const a = 1 - Math.exp(-dt * 12);
    // Leads the text when it grows so it never sits on a fresh letter.
    const nx = tx > this.anchorX ? tx : this.anchorX + (tx - this.anchorX) * a;
    const ny = this.anchorY + (ty - this.anchorY) * a;
    if (Math.abs(nx - this.anchorX) > 0.2 || Math.abs(ny - this.anchorY) > 0.2 || this.frames < 2) {
      button.style.transform = `translate3d(${nx.toFixed(1)}px, ${ny.toFixed(1)}px, 0)`;
    }
    this.anchorX = nx;
    this.anchorY = ny;
  }

  // —— draw ——————————————————————————————————————————————

  private put(o: number, g: Glyph, cell: number) {
    const d = this.glyphData;
    d[o] = g.x;
    d[o + 1] = g.y;
    d[o + 2] = g.size;
    d[o + 3] = g.rot;
    d[o + 4] = g.heat;
    d[o + 5] = g.alpha;
    d[o + 6] = cell;
    d[o + 7] = g.refl;
    d[o + 8] = g.floor;
  }

  private emit(list: Glyph[], n: number): number {
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.space || g.age < 0 || g.alpha < 0.004 || g.heat < 0.01) continue;
      this.put(n * STRIDE, g, g.cell);
      n++;
    }
    return n;
  }

  private draw(dt: number) {
    const need = (this.glyphs.length + this.dying.length + this.flying.length + 1) * STRIDE;
    if (need > this.glyphData.length) this.glyphData = new Float32Array(need * 2);
    let n = this.emit(this.glyphs, 0);
    n = this.emit(this.dying, n);
    n = this.emit(this.flying, n);
    if (this.caret.heat > 0.01) {
      this.put(n * STRIDE, this.caret, CARET_CELL);
      n++;
    }

    let stamps = 0;
    const sd = this.stampData;
    for (let i = 0; i < this.flying.length; i++) {
      const g = this.flying[i];
      if (g.t < g.delay) continue;
      const ax = g.lx;
      const ay = g.ly - MID * g.ls;
      const dx = g.x - ax;
      const dy = g.y - MID * g.size - ay;
      const dist = Math.hypot(dx, dy);
      const r = 0.9 + 0.012 * g.size;
      const K = Math.max(1, Math.min(96, Math.ceil(dist / (r * 0.45))));
      const e = (0.95 * g.alpha * Math.min(1, dist / (r * 0.45))) * (dist / K / (r * 1.77));
      for (let k = 1; k <= K && stamps < MAX_STAMPS; k++) {
        const t = k / K;
        const o = stamps * STRIDE;
        sd[o] = ax + dx * t;
        sd[o + 1] = ay + dy * t;
        sd[o + 2] = r;
        sd[o + 3] = 0;
        sd[o + 4] = g.lh + (g.heat - g.lh) * t;
        sd[o + 5] = e;
        sd[o + 6] = 0;
        sd[o + 7] = 0;
        sd[o + 8] = 0;
        stamps++;
      }
    }

    const d = this.drawList;
    d.glyphs = this.glyphData;
    d.glyphCount = n;
    d.stampCount = stamps;
    d.trail = this.trailTimer > 0;
    d.decay = Math.exp(-dt / 0.5);
    this.renderer.draw(d);
  }
}

export function createVoid(els: VoidElements): VoidHandle | null {
  try {
    return new Engine(els);
  } catch {
    return null;
  }
}
