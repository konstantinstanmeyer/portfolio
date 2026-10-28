/**
 * Boston's sun, computed locally.
 *
 * `sunkit` is deliberately self-contained (no imports, no outer references):
 * the page inlines `sunkit.toString()` as a tiny script that runs before first
 * paint, and the client store calls the very same function every minute. One
 * source of truth, so the first paint and the live page can never disagree.
 *
 * Position: the low-precision solar ephemeris used by suncalc (MIT), good to a
 * fraction of a degree. Times are formatted in America/New_York, so daylight
 * saving is the platform's job, not ours.
 */

export type Oklch = [l: number, c: number, h: number];

export type Light = {
  /** Instant this reading is for (ms since epoch). */
  t: number;
  /** Solar altitude in degrees, geometric. */
  alt: number;
  rising: boolean;
  /** Ground phase. */
  phase: "day" | "golden" | "blue" | "night";
  /** What the sentence says. */
  kind: "noon" | "day" | "late" | "golden" | "blue" | "night" | "predawn";
  /** Minutes to the event `kind` refers to (golden/blue end, golden/blue start). */
  minutes: number;
  /** Wall-clock time in Boston. */
  clock: { hm: string; ampm: string; iso: string };
  /** The next sunrise or sunset. */
  next: { name: "Sunrise" | "Sunset"; day: "today" | "tomorrow"; hm: string; ampm: string; iso: string };
  ground: Oklch;
  ink: Oklch;
  scheme: "light" | "dark";
  /** True when the URL pins the time (QA), so nothing ticks. */
  pinned: boolean;
};

export function sunkit() {
  const RAD = Math.PI / 180;
  const LAT = 42.3601;
  const LNG = -71.0589;
  const MIN = 6e4;
  const HOUR = 36e5;
  const DAY = 864e5;
  const ZONE = "America/New_York";
  const RISE = -0.833; // upper limb on the horizon, with refraction

  /* ---------- position ---------- */

  function altitude(t: number): number {
    const d = t / DAY - 10957.5; // days since J2000.0
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI;
    const e = RAD * 23.4397;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const H = RAD * (280.16 + 360.9856235 * d) + RAD * LNG - ra;
    const phi = RAD * LAT;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
  }

  /** First time after `t` (within `span`) that altitude crosses `deg` going up (dir 1) or down (dir -1). */
  function cross(t: number, deg: number, dir: 1 | -1, span = 30 * HOUR): number | null {
    const step = 5 * MIN;
    let a = t;
    let fa = altitude(a) - deg;
    for (let b = t + step; b <= t + span; b += step) {
      const fb = altitude(b) - deg;
      if ((dir > 0 && fa < 0 && fb >= 0) || (dir < 0 && fa > 0 && fb <= 0)) {
        let lo = a;
        let hi = b;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          const fm = altitude(mid) - deg;
          if ((dir > 0) === fm < 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      a = b;
      fa = fb;
    }
    return null;
  }

  /** Solar noon nearest to `t`. */
  function noon(t: number): number {
    let best = t;
    let max = -99;
    for (let s = t - 13 * HOUR; s <= t + 13 * HOUR; s += 10 * MIN) {
      const a = altitude(s);
      if (a > max) {
        max = a;
        best = s;
      }
    }
    let lo = best - 10 * MIN;
    let hi = best + 10 * MIN;
    for (let i = 0; i < 30; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (altitude(m1) < altitude(m2)) lo = m1;
      else hi = m2;
    }
    return (lo + hi) / 2;
  }

  /* ---------- Boston wall clock ---------- */

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  function wall(t: number) {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(t)) if (part.type !== "literal") p[part.type] = +part.value;
    return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
  }

  /** Boston's UTC offset at `t`, in ms (e.g. -4h in summer, -5h in winter). */
  function offset(t: number): number {
    const w = wall(t);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000;
  }

  /** A Boston wall time (y, m, d, h, min) to an instant, DST-aware. */
  function fromWall(y: number, mo: number, d: number, h: number, mi: number): number {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const first = guess - offset(guess);
    return guess - offset(first);
  }

  function clock(t: number) {
    const w = wall(t);
    const h12 = w.hour % 12 || 12;
    const pad = (n: number) => String(n).padStart(2, "0");
    const off = offset(t) / HOUR;
    const iso =
      `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}` +
      `${off < 0 ? "-" : "+"}${pad(Math.abs(off))}:00`;
    return { hm: `${h12}:${pad(w.minute)}`, ampm: w.hour < 12 ? "am" : "pm", iso, date: w.year * 1e4 + w.month * 100 + w.day };
  }

  /* ---------- the moment to light ---------- */

  /**
   * Now, unless the URL pins it for review:
   *   ?at=2026-10-28T17:00     Boston wall time (or any ISO string with an offset)
   *   ?alt=-5[&dir=up]         the moment today the sun crosses -5°, evening unless dir=up
   *   ?phase=noon|day|late|golden|blue|night|dawn|sunrise
   */
  function moment(search: string, real: number): { t: number; pinned: boolean } {
    const q = new URLSearchParams(search);
    let t = real;
    let pinned = false;
    const at = q.get("at");
    if (at) {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(at);
      const parsed = m ? fromWall(+m[1], +m[2], +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0) : Date.parse(at);
      if (!Number.isNaN(parsed)) {
        t = parsed;
        pinned = true;
      }
    }
    const presets: Record<string, [number, 1 | -1] | "noon"> = {
      noon: "noon",
      day: [24, -1],
      late: [9, -1],
      golden: [2, -1],
      blue: [-5, -1],
      night: [-30, -1],
      dawn: [-9, 1],
      sunrise: [2, 1],
    };
    const phase = q.get("phase");
    const alt = q.get("alt");
    const target = phase && presets[phase] ? presets[phase] : alt !== null && alt !== "" && !Number.isNaN(+alt) ? ([+alt, q.get("dir") === "up" ? 1 : -1] as [number, 1 | -1]) : null;
    if (target) {
      pinned = true;
      const c = clock(t);
      const date = c.date;
      const midnight = fromWall(Math.floor(date / 1e4), Math.floor(date / 100) % 100, date % 100, 0, 0);
      const high = noon(midnight + 12 * HOUR);
      if (target === "noon") t = high;
      else {
        const [deg, dir] = target;
        const hit = cross(dir > 0 ? midnight : high, deg, dir, dir > 0 ? 13 * HOUR : 12 * HOUR);
        t = hit ?? (deg > altitude(high) ? high : midnight);
      }
    }
    return { t, pinned };
  }

  /* ---------- colour ---------- */

  type Stop = [alt: number, l: number, c: number, h: number];
  // Light-scheme visitors: a crisp, faintly cool white under a high sun, warming as it lowers…
  const PAPER: Stop[] = [[90, 98.7, 0.006, 235], [30, 98.7, 0.005, 235], [20, 98.8, 0.002, 95], [12, 98.3, 0.005, 85], [6, 97.6, 0.011, 76], [0, 96.6, 0.021, 70], [-4, 96.1, 0.026, 66]];
  // …then, at -4°, the page goes out: blue hour, then night.
  const DUSK: Stop[] = [[-4, 27, 0.036, 262], [-6, 23.5, 0.031, 263], [-9, 18.5, 0.017, 264], [-12, 15, 0.006, 265], [-90, 15, 0.006, 265]];
  // Dark-scheme visitors stay dark all day; the sun only moves the ground within L 13–20%.
  const DARK_DAY: Stop[] = [[90, 17, 0.004, 85], [12, 17, 0.004, 85], [6, 17.8, 0.01, 68], [0, 18.8, 0.017, 60], [-4, 19, 0.019, 58]];
  const DARK_DUSK: Stop[] = [[-4, 20.5, 0.03, 262], [-6, 19, 0.026, 263], [-12, 14, 0.007, 265], [-90, 13, 0.005, 265]];
  const INK_DAY: [number, number, number] = [21, 0.006, 85];
  const INK_NIGHT: [number, number, number] = [91.8, 0.005, 255];
  const INK_DARK: [number, number, number] = [92, 0.004, 85];

  function along(stops: Stop[], alt: number): [number, number, number] {
    const a = Math.max(-90, Math.min(90, alt));
    for (let i = 0; i < stops.length - 1; i++) {
      const [a0, l0, c0, h0] = stops[i];
      const [a1, l1, c1, h1] = stops[i + 1];
      if (a <= a0 && a >= a1) {
        const k = a0 === a1 ? 0 : (a0 - a) / (a0 - a1);
        return [l0 + (l1 - l0) * k, c0 + (c1 - c0) * k, h0 + (h1 - h0) * k];
      }
    }
    const last = stops[stops.length - 1];
    return [last[1], last[2], last[3]];
  }

  function palette(alt: number, dark: boolean) {
    const lit = alt >= -4;
    if (dark) return { ground: along(lit ? DARK_DAY : DARK_DUSK, alt), ink: INK_DARK, scheme: "dark" as const };
    return lit
      ? { ground: along(PAPER, alt), ink: INK_DAY, scheme: "light" as const }
      : { ground: along(DUSK, alt), ink: INK_NIGHT, scheme: "dark" as const };
  }

  function css([l, c, h]: [number, number, number]): string {
    return `oklch(${l.toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(1)})`;
  }

  function hex([L, C, H]: [number, number, number]): string {
    const l = L / 100;
    const a = C * Math.cos(H * RAD);
    const b = C * Math.sin(H * RAD);
    const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
      -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
      -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
    ];
    return (
      "#" +
      rgb
        .map((v) => {
          const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
          return Math.round(Math.min(1, Math.max(0, x)) * 255)
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  }

  /* ---------- reading ---------- */

  /** The reading for now (or for the moment the URL pins). */
  function read(search: string, real: number, dark: boolean): Light {
    const { t, pinned } = moment(search, real);
    return at(t, pinned, dark);
  }

  /** The reading for any instant. */
  function at(t: number, pinned: boolean, dark: boolean): Light {
    const alt = altitude(t);
    const rising = altitude(t + 5 * MIN) > alt;
    const phase = alt >= 6 ? "day" : alt >= -4 ? "golden" : alt >= -6 ? "blue" : "night";
    const until = (deg: number, dir: 1 | -1) => {
      const at = cross(t, deg, dir);
      return at === null ? 0 : Math.max(1, Math.ceil((at - t) / MIN));
    };

    let kind: Light["kind"] = phase;
    let minutes = 0;
    if (phase === "day") {
      const toGolden = rising ? 0 : until(6, -1);
      if (Math.abs(t - noon(t)) <= 30 * MIN) kind = "noon";
      else if (toGolden > 0 && toGolden <= 60) {
        kind = "late";
        minutes = toGolden;
      }
    } else if (phase === "golden") minutes = rising ? until(6, 1) : until(-4, -1);
    else if (phase === "blue") minutes = rising ? until(-4, 1) : until(-6, -1);
    else if (rising) {
      const toBlue = until(-6, 1);
      if (toBlue > 0 && toBlue <= 60) {
        kind = "predawn";
        minutes = toBlue;
      }
    }

    const rise = cross(t, RISE, 1);
    const set = cross(t, RISE, -1);
    const isRise = rise !== null && (set === null || rise < set);
    const nextAt = (isRise ? rise : set) ?? t;
    const nc = clock(nextAt);
    const c = clock(t);
    const pal = palette(alt, dark);

    return {
      t,
      alt,
      rising,
      phase,
      kind,
      minutes,
      clock: { hm: c.hm, ampm: c.ampm, iso: c.iso },
      next: { name: isRise ? "Sunrise" : "Sunset", day: nc.date === c.date ? "today" : "tomorrow", hm: nc.hm, ampm: nc.ampm, iso: nc.iso },
      ground: pal.ground,
      ink: pal.ink,
      scheme: pal.scheme,
      pinned,
    };
  }

  /* ---------- words ---------- */

  const NBSP = "\u00a0";

  /**
   * The live sentence, phrased for every phase. Each reads as the end of
   * "Photographer and developer in Boston, where it is 4:41 pm …" and fits one
   * line at desktop width, so the statement is always two lines: who, and now.
   * Split around the time so React can wrap it in <time>; the pre-paint script
   * joins the same parts, so the first paint and the hydrated page match exactly.
   */
  function words(l: Light) {
    const deg = `${Math.round(Math.abs(l.alt))}°`;
    const mins = `${l.minutes}${NBSP}minute${l.minutes === 1 ? "" : "s"}`;
    const tail =
      l.kind === "noon"
        ? ` and the sun is at its highest, ${deg} above the horizon.`
        : l.kind === "late"
          ? ` and golden hour begins in ${mins}.`
          : l.kind === "golden"
            ? ` and golden hour has ${mins} left.`
            : l.kind === "blue"
              ? ` and blue hour has ${mins} left.`
              : l.kind === "night"
                ? ` and the sun is ${deg} below the horizon.`
                : l.kind === "predawn"
                  ? ` and blue hour begins in ${mins}.`
                  : ` and the sun is ${deg} above the horizon.`;
    return {
      now: { pre: `where it${NBSP}is `, time: `${l.clock.hm}${NBSP}${l.clock.ampm}`, post: tail },
      next: { pre: `${l.next.name} in Boston ${l.next.day}: `, time: `${l.next.hm}${NBSP}${l.next.ampm}`, post: "." },
    };
  }

  /* ---------- paint ---------- */

  /** Writes the reading into the document: tokens and words on :root, theme-color, data-phase and data-scheme. */
  function paint(light: Light) {
    const d = document;
    let style = d.getElementById("kl-sun");
    if (!style) {
      style = d.createElement("style");
      style.id = "kl-sun";
      d.head.appendChild(style);
    }
    const w = words(light);
    const str = (v: string) => JSON.stringify(v).replace(/</g, "\\3c ");
    style.textContent =
      `:root{--sun-ground:${css(light.ground)};--sun-ink:${css(light.ink)};` +
      `--sun-now:${str(w.now.pre + w.now.time + w.now.post)};--sun-next:${str(w.next.pre + w.next.time + w.next.post)}}`;
    let meta = d.getElementById("kl-sun-meta") as HTMLMetaElement | null;
    if (!meta) {
      meta = d.createElement("meta");
      meta.id = "kl-sun-meta";
      meta.name = "theme-color";
      d.head.prepend(meta);
    }
    meta.content = hex(light.ground);
    const root = d.querySelector("[data-draft='light']");
    if (root) {
      root.setAttribute("data-phase", light.phase);
      root.setAttribute("data-scheme", light.scheme);
    }
  }

  function prefersDark(): boolean {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /** The pre-paint entry point. */
  function boot() {
    paint(read(location.search, Date.now(), prefersDark()));
  }

  return { altitude, cross, noon, clock, fromWall, offset, moment, palette, hex, css, read, at, words, paint, prefersDark, boot };
}

export type SunKit = ReturnType<typeof sunkit>;
