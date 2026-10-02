// Canvas2D masks that tell the shader where the signal lives.
// All geometry is read from the real DOM so the WebGL field lines up with it.

export type Rect = { x: number; y: number; w: number; h: number };

export type NameLayout = {
  font: string;
  size: number;
  chars: { ch: string; x: number; line: number }[];
  baselines: number[];
  bounds: Rect;
};

export type BoxLayout = {
  rect: Rect;
  font: string;
  padLeft: number;
  charW: number;
  glyphTop: number;
  glyphBottom: number;
  send: Rect;
};

export type Glyph = "sent" | "error" | null;

const fontOf = (cs: CSSStyleDeclaration) =>
  `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

function rel(r: DOMRect, origin: DOMRect): Rect {
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

export function measureName(
  h1: HTMLElement,
  origin: DOMRect,
  ctx: CanvasRenderingContext2D,
): NameLayout {
  const cs = getComputedStyle(h1);
  const font = fontOf(cs);
  ctx.font = font;
  const chars: NameLayout["chars"] = [];
  const baselines: number[] = [];
  const range = document.createRange();
  const lines = h1.querySelectorAll<HTMLElement>("[data-line]");
  lines.forEach((line, li) => {
    const node = line.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    const m = ctx.measureText(text);
    const box = line.getBoundingClientRect();
    const asc = m.fontBoundingBoxAscent;
    const desc = m.fontBoundingBoxDescent;
    baselines[li] = box.top - origin.top + (box.height - (asc + desc)) / 2 + asc;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      chars.push({ ch: text[i], x: r.left - origin.left, line: li });
    }
  });
  return { font, size: parseFloat(cs.fontSize), chars, baselines, bounds: rel(h1.getBoundingClientRect(), origin) };
}

export function paintName(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  layout: NameLayout,
  scale: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  ctx.font = layout.font;
  ctx.textBaseline = "alphabetic";
  for (const c of layout.chars) {
    ctx.fillStyle = c.line === 0 ? "#f00" : "#0f0";
    ctx.fillText(c.ch, c.x, layout.baselines[c.line]);
  }
}

export function measureBox(
  input: HTMLInputElement,
  send: HTMLElement,
  origin: DOMRect,
  ctx: CanvasRenderingContext2D,
): BoxLayout {
  const cs = getComputedStyle(input);
  const font = fontOf(cs);
  ctx.font = font;
  const size = parseFloat(cs.fontSize);
  const rect = rel(input.getBoundingClientRect(), origin);
  const mid = rect.h / 2;
  return {
    rect,
    font,
    padLeft: parseFloat(cs.paddingLeft),
    charW: ctx.measureText("0").width,
    glyphTop: mid - size * 0.55,
    glyphBottom: mid + size * 0.5,
    send: rel(send.getBoundingClientRect(), input.getBoundingClientRect()),
  };
}

function stroke(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

export function paintBox(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  box: BoxLayout,
  scale: number,
  text: string,
  scroll: number,
  glyph: Glyph,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = "lighter";

  const { rect, send } = box;
  const mid = rect.h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.padLeft * 0.5, 0, send.x - box.padLeft * 0.5, rect.h);
  ctx.clip();
  ctx.font = box.font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f00";
  ctx.fillText(text, box.padLeft - scroll, mid);
  ctx.restore();

  const cx = send.x + send.w / 2;
  const cy = send.y + send.h / 2;
  const s = Math.min(send.w, send.h) * 0.36;
  ctx.lineWidth = 2;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";

  ctx.strokeStyle = "#0f0";
  stroke(ctx, [cx - s, cy, cx + s, cy]);
  stroke(ctx, [cx + s * 0.25, cy - s * 0.75, cx + s, cy, cx + s * 0.25, cy + s * 0.75]);

  ctx.strokeStyle = "#00f";
  if (glyph === "sent") {
    stroke(ctx, [cx - s, cy + s * 0.05, cx - s * 0.3, cy + s * 0.7, cx + s, cy - s * 0.65]);
  } else if (glyph === "error") {
    const k = s * 0.7;
    stroke(ctx, [cx - k, cy - k, cx + k, cy + k]);
    stroke(ctx, [cx - k, cy + k, cx + k, cy - k]);
  }
}
