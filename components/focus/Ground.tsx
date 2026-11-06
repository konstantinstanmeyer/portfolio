"use client";

import { useEffect, useRef } from "react";
import s from "./focus.module.css";

// The focus line, as a share of the frame's height (as in Space.tsx).
const FOCUS = 0.42;

// The figures are measured from the near one: centred off the frame's left
// edge, its waist a gutter short of the type's column, on the focus line;
// its radius is this multiple of the distance from the frame's edge to its
// waist, so it clears the portrait. On the right the figures come in a
// little less far than on the left (this share of the left's margin): their
// lines may pass behind the type, fine enough not to hide it. All ride up as
// the page scrolls, a long way behind it: the nearest at NEAR_RIDE, the
// farthest at FAR_RIDE.
const NEAR_SIZE = 1.3;
const RIGHT_IN = 0.85;
const NEAR_RIDE = 0.16;
const FAR_RIDE = 0.09;
// Their depth in the pointer's parallax (--k in focus.module.css): they move
// the way the photographs do (7), against the type, but by less, so that
// with the type moving the other way they never close the gutter on it.
const NEAR_DEPTH = 4;
const FAR_DEPTH = 5;
// On phones and tablets the type runs margin to margin, so the figures
// stand either side of the portrait instead, where the opening frame sets
// it, but keep the wide screen's proportions: the near one on the left, its
// radius this share of the frame's height (about what it comes to on a wide
// screen), its centre a quarter of the way down the portrait; the far one on
// the right, three fifths its size, its centre this share of the frame lower
// (a little more than on a wide screen), by the name. So their widest points
// stand beside the portrait and the name, not the wider type, and come in
// close. Each clears the portrait, the name, the line and the About by this
// much (CSS px), and from there rides with the scroll as on a wide screen.
const NARROW_SIZE = 0.72;
const NARROW_NEAR = 0.25;
const NARROW_DROP = 0.3;
const NARROW_CLEAR = 16;

// The figures. Each stands on one side of the type (0 the left, its waist
// facing right; 1 the right), at some depth (0 near, 1 far: how fast it
// rides with the scroll, and how far it moves with the pointer), with the
// hue of its double (magenta, in front of focus, or green, behind). It is
// drawn `turn` beats (LAG) after the first, over `pace` times DRAW, so no two
// arrive in step. On a wide screen: its radius as a share of the near one's,
// the height of its centre in frame heights, and how much further than a
// gutter it stands from the type. On a phone: its radius in frame heights,
// its centre's height down the portrait plus a share of the frame, and how
// much further out than it must it stands.
type Spec = {
  side: 0 | 1;
  depth: number;
  hue: "near" | "far";
  turn: number;
  pace: number;
  wide: { size: number; at: number; out: number };
  narrow: { size: number; at: number; drop: number; out: number };
};
const FIGURES: Spec[] = [
  // Left: the near figure, its waist a gutter from the type on the focus line.
  {
    side: 0,
    depth: 0,
    hue: "near",
    turn: 0,
    pace: 1,
    wide: { size: 1, at: FOCUS, out: 0 },
    narrow: { size: NARROW_SIZE, at: NARROW_NEAR, drop: 0, out: 0 },
  },
  // Left, above: centred on the frame's edge, so it arches out of it and
  // across the near figure.
  {
    side: 0,
    depth: 0.4,
    hue: "near",
    turn: 0.5,
    pace: 0.9,
    wide: { size: 0.72, at: 0.12, out: 16 },
    narrow: { size: 0.5, at: -0.35, drop: 0, out: 0 },
  },
  // On the right, three, read from the top: large, small, then large again
  // (a little smaller than the first). The two large ones cross once; this
  // small one, the farthest figure, arches out of the frame's edge across
  // the lower end of the top one, well clear of where those two cross.
  {
    side: 1,
    depth: 1,
    hue: "far",
    turn: 3.1,
    pace: 0.9,
    wide: { size: 0.32, at: 0.82, out: 200 },
    narrow: { size: NARROW_SIZE * 0.6, at: NARROW_NEAR, drop: NARROW_DROP, out: 0 },
  },
  // Right, at the top: the largest on its side.
  {
    side: 1,
    depth: 0.6,
    hue: "near",
    turn: 0.9,
    pace: 1.3,
    wide: { size: 1.15, at: 0.14, out: 0 },
    narrow: { size: 0.55, at: -0.2, drop: 0, out: 64 },
  },
  // Left, below: small, out of the frame's edge low in the corner.
  {
    side: 0,
    depth: 0.85,
    hue: "far",
    turn: 2,
    pace: 0.85,
    wide: { size: 0.4, at: 0.84, out: 56 },
    narrow: { size: 0.3, at: NARROW_NEAR, drop: 0.42, out: 0 },
  },
  // Right, below: large again, a little smaller than the top one.
  {
    side: 1,
    depth: 0.75,
    hue: "far",
    turn: 1.6,
    pace: 0.83,
    wide: { size: 1.02, at: 0.88, out: 20 },
    narrow: { size: 0.48, at: NARROW_NEAR, drop: 0.56, out: 32 },
  },
];

// How the marks read on each paper, in oklch lightness: a figure, and its
// double (with the hue and chroma of the page's secondary spectrum: magenta
// in front of focus, green behind). On dark paper 2.5:1 and 2:1, on light
// 2.4:1 and 1.9:1. Only hairlines, and never inside the type's column.
const SCHEMES = {
  light: { paper: [0.984, 0.003, 85], line: 0.72, double: 0.79, near: [335, 0.055], far: [172, 0.045] },
  dark: { paper: [0.17, 0.004, 85], line: 0.44, double: 0.39, near: [340, 0.06], far: [178, 0.045] },
} as const;

// The gap between a figure and its double, in gutters: a little narrower
// on a phone, where the figures stand closer to everything.
const GAP = 1.2;
const NARROW_GAP = 0.9;
// On load: a beat while the type racks in, then each figure drawn in from
// the top of the frame and its double from the bottom; when the lines are
// about half drawn, the double begins to close in from three
// times its gap (a little less on a phone) and settles, as the type's own
// echo does. Each figure keeps its own time (its turn and pace). After that
// they hold.
const WAIT = 0.6;
const DRAW = 1.8;
const ARRIVE_AFTER = 0.3;
const ARRIVE = 1.6;
const OPEN = 3;
const NARROW_OPEN = 2.4;
const LAG = 0.5;
// After a scroll or a move of the pointer, followed for this long (ms): the
// parallax eases over 900 ms (focus.module.css).
const FOLLOW = 1000;

// When the ground shows at all; it is hidden in CSS under anything else.
const SHOWN = "(prefers-contrast: no-preference) and (not (forced-colors: active))";

// The page's --ease-focus (a beat of stillness, a deliberate turn, a landing
// that does not dawdle), as a monotone cubic through the same stops, so the
// figures settle exactly as the type does.
const STOPS = [
  [0, 0],
  [0.08, 0.03],
  [0.2, 0.15],
  [0.36, 0.44],
  [0.52, 0.74],
  [0.66, 0.91],
  [0.8, 0.98],
  [0.92, 1],
  [1, 1],
];
const ease = (() => {
  const xs = STOPS.map((p) => p[0]);
  const ys = STOPS.map((p) => p[1]);
  const n = STOPS.length;
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      m[i] = (3 / Math.sqrt(h)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(h)) * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const u = (x - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[i] +
      (u3 - 2 * u2 + u) * h * m[i] +
      (-2 * u3 + 3 * u2) * ys[i + 1] +
      (u3 - u2) * h * m[i + 1]
    );
  };
})();

/** A figure placed: its spec's side, depth and turn, the x of its waist (its point nearest the type), its radius, and the height of its centre, in the canvas's CSS px. */
type Figure = Pick<Spec, "side" | "depth" | "hue" | "turn" | "pace"> & { waist: number; r: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number };

/** An oklch colour as a CSS rgb() string. */
function colour(l: number, c: number, h: number) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => {
    const x = Math.max(0, Math.min(1, v));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  });
  return `rgb(${rgb.join(",")})`;
}

/**
 * Great hairline circles stand far behind the page, three each side of the
 * type, crossing at their own depths, and like a rangefinder's second image
 * each has a faint double:
 * a second circle inside it, on the same centre, so the two run evenly apart
 * all the way round and never touch. On load each is drawn in from the top
 * of the frame and its double from the bottom, and the doubles close in and
 * settle, as the type's own echo does; then they hold. They move only as the
 * rest of the page does: a little with the pointer's parallax, at their own
 * depth, and slowly with the scroll. On a phone they stand either side of
 * the portrait.
 *
 * One fixed canvas under everything, drawn only when something changes.
 * With reduced motion it is the settled frame, still; with more contrast or
 * forced colours, or without JavaScript, the paper is plain.
 */
export function Ground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const root = document.querySelector<HTMLElement>('[data-draft="focus"]');
    const column = document.querySelector<HTMLElement>("[data-column]");
    const ctx = el?.getContext("2d");
    if (!el || !root || !column || !ctx) return;
    const shown = window.matchMedia(SHOWN);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const wide = window.matchMedia("(min-width: 960px)");
    const specs = FIGURES;
    const intro = Math.max(
      ...specs.map((f) => WAIT + f.turn * LAG + Math.max(DRAW * f.pace, DRAW * f.pace * ARRIVE_AFTER + ARRIVE)),
    );
    // How fast a figure rides with the scroll, and how far it moves with the
    // pointer, at its depth.
    const ride = (depth: number) => NEAR_RIDE + (FAR_RIDE - NEAR_RIDE) * depth;
    const sway = (depth: number) => NEAR_DEPTH + (FAR_DEPTH - NEAR_DEPTH) * depth;

    // The portrait, the name, the line, its caption and the About: what the
    // figures stand clear of on a phone (the type by its words, not its boxes).
    const hero = [s.portrait, s.name, s.line, s.note, s.text]
      .map((name) => document.querySelector<HTMLElement>(`.${CSS.escape(name)}`))
      .filter((node): node is HTMLElement => node !== null);
    const portrait = document.querySelector<HTMLElement>(`.${CSS.escape(s.portrait)}`);

    // Where an element sits on the page, untouched by the planes' tilt.
    const place = (node: HTMLElement): Box => {
      let left = 0;
      let top = 0;
      for (let n: HTMLElement | null = node; n; n = n.offsetParent as HTMLElement | null) {
        left += n.offsetLeft;
        top += n.offsetTop;
      }
      return { left, top, right: left + node.offsetWidth, bottom: top + node.offsetHeight };
    };

    // Where the words in an element actually run: a balanced line's box is
    // as wide as the frame, its words much narrower. Measured as drawn, and
    // carried over to its place on the page.
    const words = (node: HTMLElement, box: Box): Box => {
      if (node === portrait) return box;
      const range = document.createRange();
      range.selectNodeContents(node);
      const drawn = range.getBoundingClientRect();
      const whole = node.getBoundingClientRect();
      if (!drawn.width || !whole.width) return box;
      const scale = node.offsetWidth / whole.width;
      return {
        ...box,
        left: box.left + (drawn.left - whole.left) * scale,
        right: box.right - (whole.right - drawn.right) * scale,
      };
    };

    // On a phone: each figure as close in as it can come, clear of all of
    // them, and centred off the frame's edge, as on a wide screen, so only
    // its arc shows. A circle reaches furthest toward a box at the box's
    // height nearest its centre.
    const arrange = (photo: HTMLElement): Figure[] => {
      const p = place(photo);
      const boxes = hero.map((node) => words(node, place(node)));
      const reach = (r: number, y: number, b: Box) => {
        const dy = Math.max(0, b.top - y, y - b.bottom);
        return dy >= r ? -Infinity : Math.sqrt(r * r - dy * dy);
      };
      return specs.map(({ side, depth, hue, turn, pace, narrow }) => {
        const r = view.height * narrow.size;
        const y = p.top + (p.bottom - p.top) * narrow.at + view.height * narrow.drop;
        const waist =
          side === 0
            ? Math.min(0, ...boxes.map((b) => b.left - NARROW_CLEAR - narrow.out - reach(r, y, b))) + r
            : Math.max(view.width, ...boxes.map((b) => b.right + NARROW_CLEAR + narrow.out + reach(r, y, b))) - r;
        return { side, depth, hue, turn, pace, waist, r, y };
      });
    };

    // The type's column (on a wide screen) or the figures' places at the
    // top of the page (on a phone), and the canvas's own box: the viewport
    // less any classic scroll bar.
    let view = { width: 0, height: 0, dpr: 1 };
    let edges = { left: 0, right: 0, step: 24 };
    let beside: Figure[] = [];
    const measure = () => {
      view = { width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio || 1 };
      const gutter = parseFloat(getComputedStyle(column).getPropertyValue("--g")) || 24;
      if (wide.matches) {
        const { left } = place(column);
        edges = { left: left - gutter, right: view.width - (left - gutter) * RIGHT_IN, step: gutter };
      } else {
        edges = { ...edges, step: gutter };
        beside = portrait ? arrange(portrait) : [];
      }
      const W = Math.max(1, Math.round(view.width * view.dpr));
      const H = Math.max(1, Math.round(view.height * view.dpr));
      // Sizing a canvas clears it, so only when the size really changes.
      if (el.width !== W || el.height !== H) {
        el.width = W;
        el.height = H;
      }
    };

    // How far round a circle runs from its waist, upward or downward (in
    // radians), before it leaves the canvas a little beyond the edge. Its
    // waist faces the type: angle 0 on the left, pi on the right.
    const reach = (cx: number, cy: number, r: number, side: number, up: boolean) => {
      const mid = side === 0 ? 0 : Math.PI;
      const turn = (side === 0) === up ? -1 : 1;
      const edge = 2 * view.dpr;
      const inside = (a: number) => {
        const x = cx + r * Math.cos(mid + turn * a);
        const y = cy + r * Math.sin(mid + turn * a);
        return x >= -edge && x <= el.width + edge && y >= -edge && y <= el.height + edge;
      };
      // Its centre is off the frame, so all of it that shows lies within a
      // quarter turn of the waist.
      if (!inside(0) || inside(Math.PI / 2)) return mid + turn * (Math.PI / 2);
      let lo = 0;
      let hi = Math.PI / 2;
      for (let i = 0; i < 24; i++) {
        const a = (lo + hi) / 2;
        if (inside(a)) lo = a;
        else hi = a;
      }
      return mid + turn * hi;
    };
    // A line along a circle, drawn in from the top of the frame (or the
    // bottom) as far as `drawn` takes it; once drawn, the whole circle.
    const trace = (cx: number, cy: number, r: number, side: number, drawn: number, fromTop: boolean, stroke: string) => {
      // On a frame too short to hold it, a double has no room: leave it out.
      if (r <= view.dpr) return;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      if (drawn >= 1) {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      } else {
        const from = reach(cx, cy, r, side, fromTop);
        const to = reach(cx, cy, r, side, !fromTop);
        const end = from + (to - from) * drawn;
        ctx.arc(cx, cy, r, Math.min(from, end), Math.max(from, end));
      }
      ctx.stroke();
    };

    const start = performance.now();
    let last = "";
    /** Draws the figures as they are now; false if nothing has changed. */
    const draw = (now: number) => {
      const t = still.matches ? intro : (now - start) / 1000;
      const y = still.matches ? 0 : window.scrollY;
      // The pointer's parallax, as the page's layers have it now (the
      // properties transition, so this eases with them).
      const style = getComputedStyle(root);
      // With reduced motion the page's layers stand still, and so do these.
      const ax = still.matches ? 0 : parseFloat(style.getPropertyValue("--ax")) || 0;
      const ay = still.matches ? 0 : parseFloat(style.getPropertyValue("--ay")) || 0;
      const scheme = dark.matches ? SCHEMES.dark : SCHEMES.light;
      const { height, dpr } = view;
      const px = Math.max(1, Math.round(dpr));
      const gap = (wide.matches ? GAP : NARROW_GAP) * edges.step;
      const opening = wide.matches ? OPEN : NARROW_OPEN;
      const near = edges.left * NEAR_SIZE;
      const placed: Figure[] = wide.matches
        ? specs.map(({ side, depth, hue, turn, pace, wide: at }) => {
            // Centred off the frame's edge, so only its arc shows.
            const r = near * at.size;
            const waist = side === 0 ? Math.min(edges.left - at.out, r) : Math.max(edges.right + at.out, view.width - r);
            return { side, depth, hue, turn, pace, waist, r, y: height * at.at - y * ride(depth) };
          })
        : beside.map((f) => ({ ...f, y: f.y - y * ride(f.depth) }));
      const figures = placed.map((f) => {
        // When it starts, and how much of each line is drawn in, 0 to 1.
        const begin = WAIT + f.turn * LAG;
        const drawn = ease((t - begin) / (DRAW * f.pace));
        const open = 1 + (opening - 1) * (1 - ease((t - begin - DRAW * f.pace * ARRIVE_AFTER) / ARRIVE));
        // Snapped to whole device pixels where the line runs straight up, at
        // its waist, so it holds crisp wherever the parallax leaves it.
        const dx = Math.round(ax * sway(f.depth) * dpr);
        const dy = Math.round(ay * sway(f.depth) * 0.6 * dpr);
        const edge = f.side === 0 ? Math.round(f.waist * dpr) - px / 2 : Math.round(f.waist * dpr) + px / 2;
        const R = Math.round(f.r * dpr) + (px % 2) / 2;
        return {
          side: f.side,
          hue: scheme[f.hue],
          cx: (f.side === 0 ? edge - R : edge + R) + dx,
          cy: Math.round(f.y * dpr) + (px % 2) / 2 + dy,
          R,
          gap: gap * open * dpr,
          drawn,
        };
      });

      // Unchanged since the last frame: rest.
      const key = `${el.width}|${el.height}|${scheme.line}|${figures
        .map((f) => [f.cx, f.cy, f.R, f.gap.toFixed(2), f.drawn.toFixed(4)].join(","))
        .join("|")}`;
      if (key === last) return false;
      last = key;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      const [, chroma, hue] = scheme.paper;
      ctx.lineWidth = px;
      for (const f of figures) {
        if (f.drawn <= 0.0005) continue;
        // Each figure comes in from the top of the frame and runs down it;
        // its double (fainter, tinted, inside it on the same centre) comes in
        // from the bottom and runs up.
        trace(f.cx, f.cy, f.R, f.side, f.drawn, true, colour(scheme.line, chroma, hue));
        trace(f.cx, f.cy, f.R - f.gap, f.side, f.drawn, false, colour(scheme.double, f.hue[1], f.hue[0]));
      }
      return true;
    };

    // Drawn each frame through the arrival, and for a while after anything
    // that moves the page (until the parallax has eased to rest), then idle
    // until woken.
    let frame = 0;
    let until = start + intro * 1000 + 100;
    const tick = (now: number) => {
      frame = 0;
      if (!shown.matches || still.matches) return;
      // A photograph is open over a blurred page: the ground can rest.
      if (document.querySelector("dialog[open]")) return;
      if (draw(now) || now < until) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      until = Math.max(until, performance.now() + FOLLOW);
      if (!frame && shown.matches && !still.matches) frame = requestAnimationFrame(tick);
    };
    // Measured and drawn again at once, so a cleared canvas is never shown.
    const redraw = () => {
      if (!shown.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        ctx.clearRect(0, 0, el.width, el.height);
        last = "";
        return;
      }
      measure();
      last = "";
      draw(performance.now());
      wake();
    };

    // Moved to a screen of another density: measured again.
    let density: MediaQueryList | null = null;
    const onDensity = () => {
      density?.removeEventListener("change", onDensity);
      density = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      density.addEventListener("change", onDensity);
      redraw();
    };

    const resized = new ResizeObserver(redraw);
    onDensity();
    for (const node of [el, column, ...hero]) resized.observe(node);
    const changes = [shown, still, dark, wide];
    for (const query of changes) query.addEventListener("change", redraw);
    // What moves the page's layers moves the figures: the scroll, and the
    // pointer or the phone's tilt (Parallax.tsx).
    const moves = ["scroll", "pointermove", "deviceorientation"] as const;
    for (const type of moves) window.addEventListener(type, wake, { passive: true });
    document.documentElement.addEventListener("pointerleave", wake);
    // A photograph closed: caught up with anything that moved meanwhile.
    document.addEventListener("close", wake, true);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      density?.removeEventListener("change", onDensity);
      for (const query of changes) query.removeEventListener("change", redraw);
      for (const type of moves) window.removeEventListener(type, wake);
      document.documentElement.removeEventListener("pointerleave", wake);
      document.removeEventListener("close", wake, true);
    };
  }, []);

  return <canvas ref={canvas} className={s.ground} aria-hidden="true" />;
}
