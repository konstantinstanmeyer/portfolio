import type { SlotBridge, SlotEvent } from "./bridge";
import type { Layout } from "./layout";

type Glyph = { ch: string; x: number; w: number; t0: number };
const enum Mark {
  Enter,
  Check,
  Cross,
}

const REST = 0.8;
const OFF = 4096;

const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => v * v * (3 - 2 * v);

/** A key strike: the paper is hit, overshoots, and settles. */
function strike(t: number): number {
  if (t <= 0) return 0;
  if (t < 0.05) {
    const k = t / 0.05;
    return 1.22 * (1 - (1 - k) * (1 - k));
  }
  const u = t - 0.05;
  return 1 + 0.22 * Math.exp(-u / 0.06) * Math.cos(u * 26);
}

/**
 * The visitor's words as a coverage mask for the slot: each glyph is a blind impression
 * whose depth is animated (strike on type, relax on delete, ironed flat on send).
 */
export class TypeLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private live: Glyph[] = [];
  private ghosts: Glyph[] = [];
  private flat: Glyph[] = [];
  private widths = new Map<string, number>();
  private text = "";
  private caretIndex = 0;
  private scroll = 0;
  private flatScroll = 0;
  private version = -1;
  private focused = false;
  private font = "";
  private w = 1;
  private h = 1;
  private scale = 1;
  private left = 0;
  private right = 0;
  private markX = 0;
  private markY = 0;
  private typedAt = -10;
  private sendAt = -10;
  private sentAt = -10;
  private errorAt = -10;
  private emptyAt = -10;
  private pending = false;
  private mark = Mark.Enter;
  private markAt = -10;
  private prevMark = Mark.Enter;
  private animUntil = 0;
  private sizeChanged = true;

  caretX = 0;
  caretDepth = 0;
  rollerX = -100;
  rollerAmp = 0;
  sink = 1;

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  /** True once after the backing canvas was resized (needs a full texture re-upload). */
  takeResize(): boolean {
    const r = this.sizeChanged;
    this.sizeChanged = false;
    return r;
  }

  layout(L: Layout, dpr: number) {
    const scale = Math.min(Math.max(dpr, 1), 2);
    const w = Math.max(1, Math.ceil(L.slot.w * scale));
    const h = Math.max(1, Math.ceil(L.slot.h * scale));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.sizeChanged = true;
    }
    this.ctx.font = L.textFont;
    this.scale = scale;
    this.w = L.slot.w;
    this.h = L.slot.h;
    this.left = L.textLeft;
    this.right = L.textRight;
    this.markX = L.mark.x;
    this.markY = L.mark.y;
    if (this.font !== L.textFont) {
      this.font = L.textFont;
      this.widths.clear();
      this.reflow(this.live);
    }
    this.animUntil = Infinity;
  }

  event(e: SlotEvent, now: number) {
    if (e === "submit") {
      this.pending = true;
      this.sendAt = now;
    } else if (e === "sent") {
      this.pending = false;
      this.sentAt = Math.max(now, this.sendAt + 0.22);
      this.flat = this.live;
      this.flatScroll = this.scroll;
      this.live = [];
      this.ghosts = [];
      this.text = "";
      this.setMark(Mark.Check, this.sentAt + 0.62);
    } else if (e === "error") {
      this.pending = false;
      this.errorAt = now;
      this.setMark(Mark.Cross, now);
    } else {
      this.emptyAt = now;
    }
    this.animUntil = Infinity;
  }

  sync(bridge: SlotBridge, now: number) {
    if (bridge.version === this.version) return;
    this.version = bridge.version;
    this.focused = bridge.focused;
    if (bridge.text !== this.text) {
      this.diff(bridge.text, now);
      this.typedAt = now;
    }
    this.caretIndex = bridge.caret;
    this.scroll = bridge.scroll;
    this.animUntil = Infinity;
  }

  /** Advances animations; returns true when the mask canvas was redrawn. */
  update(now: number, reduced: boolean): boolean {
    if (this.mark !== Mark.Enter && now > this.markAt + (this.mark === Mark.Check ? 1.9 : 1.5)) {
      this.setMark(Mark.Enter, now);
    }

    const sinceSend = now - this.sendAt;
    const sinceSent = now - this.sentAt;
    const sinceError = now - this.errorAt;
    let sink = 1;
    if (this.pending) sink = 1 + 0.5 * smooth(sat(sinceSend / 0.25));
    else if (sinceSent >= 0 && sinceSent < 1.2) sink = 1 + 0.5 * (1 - smooth(sat(sinceSent / 0.9)));
    else if (sinceError < 0.5) sink = 1 + 0.5 * (1 - smooth(sat(sinceError / 0.3)));
    this.sink = sink;

    if (!reduced && sinceSent >= 0 && sinceSent < 0.9) {
      const k = sinceSent / 0.9;
      const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
      this.rollerX = -10 + (this.w + 20) * e;
      this.rollerAmp = 0.45 * Math.sin(Math.PI * k);
    } else {
      this.rollerX = -100;
      this.rollerAmp = 0;
    }

    const shake = reduced ? 0 : this.shake(now);
    this.caretX = this.left + this.prefixWidth(this.caretIndex) - this.scroll + shake;
    if (this.pending || (sinceSent >= 0 && sinceSent < 0.9)) {
      this.caretDepth = 0;
    } else if (this.focused) {
      const since = now - this.typedAt;
      this.caretDepth = reduced || since < 0.5 ? 1 : sat(Math.cos((since / 1.1) * Math.PI * 2) * 2.5 + 0.5);
    } else if (this.text.length === 0) {
      this.caretDepth = reduced ? 0.45 : 0.6 * Math.pow(0.5 - 0.5 * Math.cos((now / 3.4) * Math.PI * 2), 1.6);
    } else {
      this.caretDepth = 0;
    }

    if (now > this.animUntil) return false;
    this.draw(now, reduced, shake);
    return true;
  }

  private setMark(mark: Mark, at: number) {
    this.prevMark = this.mark;
    this.mark = mark;
    this.markAt = at;
    this.animUntil = Infinity;
  }

  private shake(now: number): number {
    const t = now - this.errorAt;
    if (t < 0 || t > 0.8) return 0;
    return 5 * Math.exp(-t / 0.16) * Math.sin(t * 48);
  }

  private measure(ch: string): number {
    let w = this.widths.get(ch);
    if (w === undefined) {
      w = this.ctx.measureText(ch).width;
      this.widths.set(ch, w);
    }
    return w;
  }

  private reflow(glyphs: Glyph[]) {
    let x = 0;
    for (const g of glyphs) {
      g.w = this.measure(g.ch);
      g.x = x;
      x += g.w;
    }
  }

  private prefixWidth(index: number): number {
    let units = 0;
    for (const g of this.live) {
      if (units >= index) return g.x;
      units += g.ch.length;
    }
    const last = this.live[this.live.length - 1];
    return last ? last.x + last.w : 0;
  }

  private diff(next: string, now: number) {
    const a = Array.from(this.text);
    const b = Array.from(next);
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const removed = this.live.slice(pre, this.live.length - suf);
    if (suf === 0) for (const g of removed) this.ghosts.push({ ch: g.ch, x: g.x - this.scroll, w: g.w, t0: now });
    const inserted = b.slice(pre, b.length - suf).map((ch) => ({ ch, x: 0, w: 0, t0: now }));
    this.live = [...this.live.slice(0, pre), ...inserted, ...this.live.slice(this.live.length - suf)];
    this.text = next;
    this.reflow(this.live);
  }

  private draw(now: number, reduced: boolean, shake: number) {
    const { ctx, scale } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Shapes are drawn far off-canvas; only their blurred shadow lands in view.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 1.3 * scale;
    ctx.shadowOffsetX = OFF * scale;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.font = this.font;
    ctx.textBaseline = "middle";
    const cy = this.h / 2 - 0.5;
    const x0 = this.left - 6;
    const x1 = this.right + 2;
    let animating = shake !== 0;

    for (const g of this.live) {
      const t = now - g.t0;
      if (t < 0.4) animating = true;
      const x = this.left + g.x - this.scroll + shake;
      this.glyph(g.ch, x, cy, REST * (reduced ? 1 : strike(t)) * this.fade(x, g.w, x0, x1));
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      const a = reduced ? 0 : REST * Math.exp(-(now - g.t0) / 0.09);
      if (a < 0.01) {
        this.ghosts.splice(i, 1);
        continue;
      }
      animating = true;
      const x = this.left + g.x;
      this.glyph(g.ch, x, cy, a * this.fade(x, g.w, x0, x1));
    }
    if (this.flat.length) {
      const t = now - this.sentAt;
      if (t > 1.0) {
        this.flat = [];
      } else {
        animating = true;
        for (const g of this.flat) {
          const x = this.left + g.x - this.flatScroll;
          const passed = reduced ? sat(t / 0.35) : sat((this.rollerX - (x + g.w / 2)) / 10 + 0.5);
          this.glyph(g.ch, x, cy, REST * (1 - smooth(passed)) * this.fade(x, g.w, x0, x1));
        }
      }
    }

    // Symbol-only send control, pressed into the right end of the slot.
    const mt = now - this.markAt;
    const et = now - this.emptyAt;
    if (mt < 0.5 || et < 0.6) animating = true;
    const nudge = reduced || et > 0.6 ? 0 : 3 * Math.exp(-et / 0.12) * Math.sin(et * 55);
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const mx = this.markX + nudge;
    if (mt < 0) {
      this.markPath(this.prevMark, mx, this.markY, REST);
    } else {
      this.markPath(this.prevMark, mx, this.markY, reduced ? 0 : REST * Math.exp(-mt / 0.08));
      this.markPath(this.mark, mx, this.markY, REST * (reduced ? 1 : strike(mt)));
    }

    if (!animating && !this.pending) this.animUntil = now;
  }

  private fade(x: number, w: number, x0: number, x1: number): number {
    return sat((x - x0) / 10) * sat((x1 - (x + w)) / 10);
  }

  private glyph(ch: string, x: number, y: number, alpha: number) {
    if (alpha < 0.004) return;
    this.ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    this.ctx.fillText(ch, x - OFF, y);
  }

  private markPath(mark: Mark, cx: number, cy: number, alpha: number) {
    if (alpha < 0.004) return;
    const { ctx } = this;
    const x = cx - OFF;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.beginPath();
    if (mark === Mark.Enter) {
      ctx.moveTo(x + 4.5, cy - 4.5);
      ctx.lineTo(x + 4.5, cy + 1.5);
      ctx.lineTo(x - 4.5, cy + 1.5);
      ctx.moveTo(x - 1.6, cy - 1.4);
      ctx.lineTo(x - 4.5, cy + 1.5);
      ctx.lineTo(x - 1.6, cy + 4.4);
    } else if (mark === Mark.Check) {
      ctx.moveTo(x - 4.6, cy + 0.2);
      ctx.lineTo(x - 1.4, cy + 3.5);
      ctx.lineTo(x + 4.8, cy - 3.7);
    } else {
      ctx.moveTo(x - 3.6, cy - 3.6);
      ctx.lineTo(x + 3.6, cy + 3.6);
      ctx.moveTo(x + 3.6, cy - 3.6);
      ctx.lineTo(x - 3.6, cy + 3.6);
    }
    ctx.stroke();
  }
}
