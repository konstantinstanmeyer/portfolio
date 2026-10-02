export type Rect = { x: number; y: number; w: number; h: number };
export type NameGlyph = { ch: string; x: number; y: number };

export type Layout = {
  width: number;
  height: number;
  nameFont: string;
  nameSize: number;
  glyphs: NameGlyph[];
  nameBox: Rect;
  slot: Rect;
  textFont: string;
  textLeft: number;
  textRight: number;
  mark: { x: number; y: number };
  signature: string;
};

const STRETCH: ReadonlyArray<readonly [number, string]> = [
  [50, "ultra-condensed"],
  [62.5, "extra-condensed"],
  [75, "condensed"],
  [87.5, "semi-condensed"],
  [100, "normal"],
  [112.5, "semi-expanded"],
  [125, "expanded"],
  [150, "extra-expanded"],
  [200, "ultra-expanded"],
];

function stretchKeyword(value: string): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return value || "normal";
  let best = STRETCH[4];
  for (const s of STRETCH) if (Math.abs(s[0] - n) < Math.abs(best[0] - n)) best = s;
  return best[1];
}

/** CSS font shorthand usable by CanvasRenderingContext2D.font. */
export function canvasFont(cs: CSSStyleDeclaration): string {
  return `${cs.fontStyle} ${cs.fontWeight} ${stretchKeyword(cs.fontStretch)} ${cs.fontSize} ${cs.fontFamily}`;
}

/** Distance from the top of a text run's box to its alphabetic baseline, as laid out by the browser. */
function baselineOffset(host: HTMLElement, cs: CSSStyleDeclaration): number {
  const probeHost = document.createElement("div");
  const s = probeHost.style;
  s.position = "absolute";
  s.left = "-9999px";
  s.top = "0";
  s.whiteSpace = "nowrap";
  s.lineHeight = "normal";
  s.fontFamily = cs.fontFamily;
  s.fontSize = cs.fontSize;
  s.fontWeight = cs.fontWeight;
  s.fontStretch = cs.fontStretch;
  s.fontStyle = cs.fontStyle;
  const text = document.createTextNode("H");
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  probeHost.append(text, probe);
  host.append(probeHost);
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 1);
  const offset = probe.getBoundingClientRect().top - range.getBoundingClientRect().top;
  probeHost.remove();
  return offset;
}

export function measureLayout(root: HTMLElement): Layout | null {
  const words = root.querySelectorAll<HTMLElement>("[data-word]");
  const form = root.querySelector<HTMLElement>("[data-slot]");
  const input = form?.querySelector<HTMLInputElement>("input[name=message]");
  const mark = form?.querySelector<HTMLElement>("[data-mark]");
  if (!words.length || !form || !input || !mark) return null;

  const rr = root.getBoundingClientRect();
  const cs = getComputedStyle(words[0]);
  const offset = baselineOffset(root, cs);
  const glyphs: NameGlyph[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const range = document.createRange();
  for (const word of words) {
    const node = word.firstChild;
    if (!(node instanceof Text)) continue;
    let i = 0;
    for (const ch of node.data) {
      range.setStart(node, i);
      range.setEnd(node, i + ch.length);
      i += ch.length;
      const r = range.getBoundingClientRect();
      const x = r.left - rr.left;
      const y = r.top - rr.top;
      glyphs.push({ ch, x, y: y + offset });
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + r.width);
      y1 = Math.max(y1, y + r.height);
    }
  }
  if (!glyphs.length) return null;

  const fr = form.getBoundingClientRect();
  const ir = input.getBoundingClientRect();
  const mr = mark.getBoundingClientRect();
  const ics = getComputedStyle(input);
  const nameFont = canvasFont(cs);
  const slot = { x: fr.left - rr.left, y: fr.top - rr.top, w: fr.width, h: fr.height };

  return {
    width: rr.width,
    height: rr.height,
    nameFont,
    nameSize: parseFloat(cs.fontSize),
    glyphs,
    nameBox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    slot,
    textFont: canvasFont(ics),
    textLeft: ir.left - fr.left + parseFloat(ics.paddingLeft),
    textRight: ir.right - fr.left - parseFloat(ics.paddingRight),
    mark: { x: mr.left - fr.left + mr.width / 2, y: mr.top - fr.top + mr.height / 2 },
    signature: `${nameFont}|${glyphs.map((g) => `${g.x.toFixed(1)},${g.y.toFixed(1)}`).join(";")}`,
  };
}
