// The name is metal in the dark: grey at rest, lit by nearby light, and
// heated when a message arrives. Heat conducts along it and radiates away.

const LEVELS = 48;
const LIGHTS = 8;
const MAX_HEAT = 1.3;
const BASE: [number, number, number] = [138, 132, 126];

function ramp(t: number): [number, number, number] {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const r = c(t * 2.3);
  const g = Math.pow(c((t - 0.22) * 1.55), 1.15);
  const b = Math.pow(c((t - 0.5) * 2.2), 1.2);
  return [r * 255, g * 255, b * 255];
}

function buildTables() {
  const color: string[] = [];
  const shadow: string[] = [];
  for (let l = 0; l < LIGHTS; l++) {
    const lit = l / (LIGHTS - 1);
    // Grey metal, warmed a little by the light of the words nearby...
    const br = Math.min(255, BASE[0] * (1 + lit * 0.5) + lit * 18);
    const bg = Math.min(255, BASE[1] * (1 + lit * 0.36) + lit * 6);
    const bb = Math.min(255, BASE[2] * (1 + lit * 0.12));
    for (let h = 0; h < LEVELS; h++) {
      // ...and glowing through the incandescent ramp when heated.
      const heat = (h / (LEVELS - 1)) * MAX_HEAT;
      const [r, g, b] = ramp(heat);
      const k = Math.min(1, heat * 1.5);
      const R = Math.round(br + (r - br) * k);
      const G = Math.round(bg + (g - bg) * k);
      const B = Math.round(bb + (b - bb) * k);
      color.push(h === 0 && l === 0 ? "transparent" : `rgb(${R} ${G} ${B})`);
    }
  }
  for (let h = 0; h < LEVELS; h++) {
    const heat = (h / (LEVELS - 1)) * MAX_HEAT;
    if (heat < 0.12) {
      shadow.push("none");
      continue;
    }
    const [r, g, b] = ramp(heat * 0.72);
    const a = Math.min(1, heat) * 0.85;
    shadow.push(
      `0 0 ${(2 + heat * 6).toFixed(1)}px rgb(${r | 0} ${g | 0} ${b | 0} / ${a.toFixed(2)}), 0 0 ${(12 + heat * 22).toFixed(1)}px rgb(${r | 0} ${(g * 0.45) | 0} 0 / ${(a * 0.5).toFixed(2)})`,
    );
  }
  return { color, shadow };
}

let tables: ReturnType<typeof buildTables> | null = null;

export class NameGlow {
  readonly count: number;
  readonly heat: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly fontSize: { value: number } = { value: 14 };
  private readonly next: Float32Array;
  private readonly shown: Int16Array;
  private readonly shownShadow: Int16Array;
  private readonly letters: number[] = [];
  light = 0;

  constructor(private readonly spans: HTMLElement[]) {
    tables ??= buildTables();
    this.count = spans.length;
    this.heat = new Float32Array(this.count);
    this.next = new Float32Array(this.count);
    this.tx = new Float32Array(this.count);
    this.ty = new Float32Array(this.count);
    this.shown = new Int16Array(this.count).fill(-1);
    this.shownShadow = new Int16Array(this.count).fill(-1);
    spans.forEach((s, i) => {
      if (s.textContent?.trim()) this.letters.push(i);
    });
  }

  /** Letter centres on the baseline, relative to `origin`. */
  measure(origin: DOMRect) {
    for (let i = 0; i < this.count; i++) {
      const r = this.spans[i].getBoundingClientRect();
      this.tx[i] = r.left - origin.left + r.width / 2;
      this.ty[i] = r.top - origin.top + r.height * 0.8;
      if (i === 0) this.fontSize.value = parseFloat(getComputedStyle(this.spans[i]).fontSize) || 14;
    }
  }

  /** Which name letter the k-th of n travelling letters should land in. */
  targetFor(k: number, n: number): number {
    const m = this.letters.length;
    if (m === 0) return 0;
    const t = n <= 1 ? 0.5 : k / (n - 1);
    return this.letters[Math.min(m - 1, Math.round(t * (m - 1)))];
  }

  deposit(i: number, amount: number) {
    this.heat[i] = Math.min(MAX_HEAT, this.heat[i] + amount);
  }

  get warm() {
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.heat[i];
    return s;
  }

  step(dt: number) {
    const n = this.count;
    const h = this.heat;
    const nx = this.next;
    const d = Math.min(0.45, 2.6 * dt);
    for (let i = 0; i < n; i++) {
      const l = h[i > 0 ? i - 1 : i];
      const r = h[i < n - 1 ? i + 1 : i];
      const v = h[i] + d * (l + r - 2 * h[i]);
      // Radiative loss: hot metal sheds heat fast, embers linger.
      nx[i] = Math.max(0, v - v * (0.14 + 0.38 * v * v) * dt);
    }
    h.set(nx);
  }

  apply() {
    const t = tables;
    if (!t) return;
    const li = Math.min(LIGHTS - 1, Math.round(this.light * (LIGHTS - 1)));
    for (let i = 0; i < this.count; i++) {
      const hi = Math.min(LEVELS - 1, Math.round((this.heat[i] / MAX_HEAT) * (LEVELS - 1)));
      const idx = li * LEVELS + hi;
      if (idx !== this.shown[i]) {
        this.shown[i] = idx;
        this.spans[i].style.color = t.color[idx];
      }
      if (hi !== this.shownShadow[i]) {
        this.shownShadow[i] = hi;
        this.spans[i].style.textShadow = t.shadow[hi];
      }
    }
  }

  reset() {
    this.heat.fill(0);
    this.shown.fill(-1);
    this.shownShadow.fill(-1);
    for (const s of this.spans) {
      s.style.color = "";
      s.style.textShadow = "";
    }
  }
}
