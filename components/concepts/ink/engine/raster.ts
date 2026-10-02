import type { Rect } from "./fluid";

const MAX_TEX = 4096;

export type Raster = { canvas: HTMLCanvasElement; rect: Rect; size: number };

export function fontOf(el: Element) {
  const cs = getComputedStyle(el);
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

function prepare(canvas: HTMLCanvasElement, w: number, h: number, scale: number) {
  const s = Math.min(scale, MAX_TEX / Math.max(w, h, 1));
  canvas.width = Math.max(1, Math.ceil(w * s));
  canvas.height = Math.max(1, Math.ceil(h * s));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  return ctx;
}

/**
 * Redraws the heading's own laid-out text runs into a glyph stamp, so the ink
 * lands exactly where the server-rendered heading sits.
 */
export function rasterizeHeading(h1: HTMLElement, scale: number, canvas: HTMLCanvasElement): Raster | null {
  const font = fontOf(h1);
  const range = document.createRange();
  const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
  const runs: { text: string; x: number; y: number }[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    if (!text.trim()) continue;
    range.selectNodeContents(n);
    const r = range.getClientRects()[0];
    if (!r) continue;
    runs.push({ text, x: r.left, y: r.top });
    x0 = Math.min(x0, r.left);
    y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.right);
    y1 = Math.max(y1, r.bottom);
  }
  if (!runs.length) return null;
  const size = parseFloat(getComputedStyle(h1).fontSize) || 16;
  const pad = Math.ceil(size * 0.5);
  const rect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  const ctx = prepare(canvas, rect.w, rect.h, scale);
  if (!ctx) return null;
  ctx.font = font;
  const ascent = ctx.measureText(runs[0].text).fontBoundingBoxAscent;
  for (const run of runs) ctx.fillText(run.text, run.x - rect.x, run.y - rect.y + ascent);
  return { canvas, rect, size };
}

/** Where the text of an <input> is drawn, in viewport CSS pixels. */
export function inputMetrics(input: HTMLInputElement, ctx: CanvasRenderingContext2D) {
  const r = input.getBoundingClientRect();
  const cs = getComputedStyle(input);
  const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) - input.scrollLeft;
  const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const innerH = r.height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
    - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  ctx.font = fontOf(input);
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  const baseline = top + (innerH - (asc + desc)) / 2 + asc;
  return { left, baseline, box: r, asc, desc };
}

/** The typed line, rasterised in place so it can dissolve into the water. */
export function rasterizeInput(
  input: HTMLInputElement,
  text: string,
  scale: number,
  canvas: HTMLCanvasElement,
): Raster | null {
  const probe = canvas.getContext("2d");
  if (!probe) return null;
  const m = inputMetrics(input, probe);
  const cs = getComputedStyle(input);
  const clipL = m.box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const clipR = m.box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
  probe.font = fontOf(input);
  const full = probe.measureText(text).width;
  const x0 = Math.max(m.left, clipL);
  const x1 = Math.min(m.left + full, clipR);
  const pad = Math.ceil((m.asc + m.desc) * 0.8);
  const rect = {
    x: x0 - pad,
    y: m.baseline - m.asc - pad,
    w: Math.max(1, x1 - x0) + pad * 2,
    h: m.asc + m.desc + pad * 2,
  };
  const ctx = prepare(canvas, rect.w, rect.h, scale);
  if (!ctx) return null;
  ctx.font = fontOf(input);
  ctx.beginPath();
  ctx.rect(x0 - rect.x - 1, 0, x1 - x0 + 2, rect.h);
  ctx.clip();
  ctx.fillText(text, m.left - rect.x, m.baseline - rect.y);
  return { canvas, rect, size: m.asc + m.desc };
}
