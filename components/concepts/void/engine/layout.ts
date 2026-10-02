import { FLOOR, LINE_HEIGHT, MID } from "./constants";

export interface Frame {
  cx: number;
  cy: number;
  s0: number;
  sMin: number;
  maxW: number;
  maxH: number;
}

/** Per-grapheme metrics in ems: advance, kerning applied before it, whitespace. */
export interface Metrics {
  adv: number[];
  kern: number[];
  space: boolean[];
}

export interface Layout {
  size: number;
  lh: number;
  x: number[];
  y: number[];
  line: number[];
  hidden: boolean[];
  fade: number[];
  lastLine: number;
  floor: number;
  caretX: number;
  caretY: number;
  endX: number;
  endY: number;
  baselines: number[];
  firstVisible: number;
  visibleLines: number;
}

function wrap(m: Metrics, maxW: number): number[] {
  const n = m.adv.length;
  const starts = [0];
  let lineW = 0;
  let i = 0;
  while (i < n) {
    if (m.space[i]) {
      lineW += m.adv[i];
      i++;
      continue;
    }
    let j = i;
    let wordW = 0;
    while (j < n && !m.space[j]) {
      wordW += m.adv[j] + (j > i ? m.kern[j] : 0);
      j++;
    }
    const start = starts[starts.length - 1];
    if (lineW + wordW > maxW && i > start) {
      starts.push(i);
      lineW = 0;
    }
    if (wordW > maxW) {
      for (let k = i; k < j; k++) {
        const s = starts[starts.length - 1];
        const a = m.adv[k] + (k > s ? m.kern[k] : 0);
        if (lineW + a > maxW && k > s) {
          starts.push(k);
          lineW = m.adv[k];
        } else lineW += a;
      }
    } else lineW += wordW;
    i = j;
  }
  return starts;
}

export function layoutText(m: Metrics, cursor: number, f: Frame): Layout {
  const n = m.adv.length;
  let size = f.s0;
  let starts: number[];
  for (;;) {
    starts = wrap(m, f.maxW / size);
    if (starts.length * LINE_HEIGHT * size <= f.maxH || size <= f.sMin) break;
    size = Math.max(f.sMin, size * 0.92);
  }
  const lh = LINE_HEIGHT * size;
  const lines = starts.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const line = new Array<number>(n);
  const hidden = new Array<boolean>(n);
  const fade = new Array<number>(n);

  // Which line the cursor sits on decides the visible window when text overflows.
  let cursorLine = 0;
  for (let l = 0; l < lines; l++) if (starts[l] <= Math.max(0, cursor - 1)) cursorLine = l;
  const visibleLines = Math.max(1, Math.min(lines, Math.floor(f.maxH / lh)));
  const firstVisible = Math.max(0, Math.min(lines - visibleLines, cursorLine - visibleLines + 1));
  const lastLine = firstVisible + visibleLines - 1;

  const baselines: number[] = [];
  for (let l = 0; l < lines; l++) {
    baselines.push(f.cy + MID * size + (l - firstVisible - (visibleLines - 1) / 2) * lh);
  }

  let endX = f.cx;
  for (let l = 0; l < lines; l++) {
    const a = starts[l];
    const b = l + 1 < lines ? starts[l + 1] : n;
    let e = b;
    if (l + 1 < lines) while (e > a && m.space[e - 1]) e--;
    let w = 0;
    for (let i = a; i < e; i++) w += m.adv[i] + (i > a ? m.kern[i] : 0);
    let pen = f.cx - (w * size) / 2;
    for (let i = a; i < b; i++) {
      if (i > a) pen += m.kern[i] * size;
      x[i] = pen + (m.adv[i] * size) / 2;
      y[i] = baselines[l];
      line[i] = l;
      hidden[i] = l < firstVisible || l > lastLine;
      // When text overflows, the oldest visible lines dim like memory.
      fade[i] = firstVisible > 0 && l - firstVisible < 2 ? 0.35 + 0.3 * (l - firstVisible) : 1;
      pen += m.adv[i] * size;
    }
    if (l === lines - 1) endX = pen;
  }

  const gap = 0.06 * size;
  let caretX = f.cx;
  let caretY = baselines[0];
  if (n > 0) {
    if (cursor <= 0) {
      caretX = x[0] - (m.adv[0] * size) / 2 - gap;
      caretY = y[0];
    } else {
      const k = Math.min(cursor, n) - 1;
      caretX = x[k] + (m.adv[k] * size) / 2 + gap * 0.5;
      caretY = y[k];
    }
  }

  return {
    size,
    lh,
    x,
    y,
    line,
    hidden,
    fade,
    lastLine,
    floor: baselines[lastLine] + FLOOR * size,
    caretX,
    caretY,
    endX,
    endY: baselines[lines - 1] - MID * size,
    baselines,
    firstVisible,
    visibleLines,
  };
}

/** Grapheme index nearest to a point, or -1 when the point is off the text. */
export function hitTest(l: Layout, m: Metrics, px: number, py: number): number {
  const n = m.adv.length;
  if (n === 0) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let li = l.firstVisible; li <= l.lastLine; li++) {
    const d = Math.abs(py - (l.baselines[li] - MID * l.size));
    if (d < bestD) {
      bestD = d;
      best = li;
    }
  }
  if (best < 0 || bestD > l.lh * 0.75) return -1;
  let idx = -1;
  let dx = Infinity;
  for (let i = 0; i < n; i++) {
    if (l.line[i] !== best) continue;
    const half = (m.adv[i] * l.size) / 2;
    const left = Math.abs(px - (l.x[i] - half));
    const right = Math.abs(px - (l.x[i] + half));
    if (left < dx) {
      dx = left;
      idx = i;
    }
    if (right < dx) {
      dx = right;
      idx = i + 1;
    }
  }
  return dx > l.size * 1.5 ? -1 : idx;
}
