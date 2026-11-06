"use client";

import { useSyncExternalStore } from "react";
import { sunkit, type Light } from "./sun";
import s from "./light.module.css";

/*
 * One module-level store for the page's live reading.
 *
 * The pre-paint script has already lit the ground and written the words into
 * CSS (so the first paint is complete). This store keeps both current, once a
 * minute, and renders the words as real text. The server snapshot is null, so
 * the server and hydration render the static fallback: no hydration mismatch.
 *
 * Pressing the time plays Boston's next 24 hours of light in ten seconds, then
 * settles back on now. It is the only animation on the page, and only the
 * reader starts it; with reduced motion the time is plain text.
 */

const kit = sunkit();
const DAY = 864e5;
const LAPSE = 10_000;

type Reading = { light: Light; playing: boolean; still: boolean };

const listeners = new Set<() => void>();
let reading: Reading | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let flipTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;

const media = (q: string) => window.matchMedia(q);
const dark = () => kit.prefersDark();
const still = () => media("(prefers-reduced-motion: reduce)").matches;
const root = () => document.querySelector<HTMLElement>("[data-draft='light']");

function now(): Light {
  return kit.read(window.location.search, Date.now(), dark());
}

function emit(next: Reading) {
  reading = next;
  listeners.forEach((fn) => fn());
}

/** Repaint, crossfading in 600ms when the phase changes (the ink flips at -4°); otherwise the ground drifts. */
function show(light: Light, crossfade: boolean) {
  const prev = reading?.light;
  const el = root();
  if (el && prev && (crossfade || prev.phase !== light.phase || prev.scheme !== light.scheme)) {
    el.setAttribute("data-flip", "");
    clearTimeout(flipTimer);
    flipTimer = setTimeout(() => el.removeAttribute("data-flip"), 700);
  }
  kit.paint(light);
}

function update(crossfade = false) {
  if (reading?.playing) return;
  const light = now();
  show(light, crossfade);
  root()?.setAttribute("data-live", "");
  const prev = reading?.light;
  const w = kit.words(light);
  const same = prev && JSON.stringify(kit.words(prev)) === JSON.stringify(w) && prev.phase === light.phase;
  if (!same || reading?.still !== still()) emit({ light, playing: false, still: still() });
}

function schedule() {
  clearTimeout(timer);
  if (reading?.light.pinned) return;
  // Wake just after each minute turns over.
  timer = setTimeout(() => {
    update();
    schedule();
  }, 60_000 - (Date.now() % 60_000) + 30);
}

/* ---------- the day, in ten seconds ---------- */

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Maps progress (0–1) onto the next 24 hours, lingering where the light
 * changes: time near the horizon (golden and blue hour) is given about six
 * times the screen time of deep night or high noon.
 */
function timeline(from: number) {
  const n = 720; // two-minute samples
  const acc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const alt = kit.altitude(from + (i / n) * DAY);
    acc[i + 1] = acc[i] + 1 + 5 * Math.exp(-((alt / 7) ** 2));
  }
  return (q: number) => {
    const target = q * acc[n];
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (acc[mid] < target) lo = mid;
      else hi = mid;
    }
    const k = (target - acc[lo]) / (acc[hi] - acc[lo] || 1);
    return from + ((lo + k) / n) * DAY;
  };
}

function stop() {
  cancelAnimationFrame(frame);
  root()?.removeAttribute("data-lapse");
  const light = now();
  show(light, true);
  emit({ light, playing: false, still: still() });
  schedule();
}

function play() {
  if (!reading || reading.playing || still()) return;
  clearTimeout(timer);
  const map = timeline(reading.light.t);
  const start = performance.now();
  root()?.setAttribute("data-lapse", "");
  const step = (ms: number) => {
    const p = Math.min(1, (ms - start) / LAPSE);
    const light = kit.at(map(ease(p)), true, dark());
    show(light, false);
    emit({ light, playing: true, still: false });
    if (p < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  frame = requestAnimationFrame(step);
}

function toggle() {
  if (reading?.playing) stop();
  else play();
}

/* ---------- subscription ---------- */

function onVisible() {
  if (document.visibilityState === "hidden" && reading?.playing) stop();
  if (document.visibilityState === "visible") {
    update(true);
    schedule();
  }
}

function onPreference() {
  update(true);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) {
    update();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    media("(prefers-color-scheme: dark)").addEventListener("change", onPreference);
    media("(prefers-reduced-motion: reduce)").addEventListener("change", onPreference);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisible);
      media("(prefers-color-scheme: dark)").removeEventListener("change", onPreference);
      media("(prefers-reduced-motion: reduce)").removeEventListener("change", onPreference);
    }
  };
}

function getSnapshot(): Reading {
  if (!reading) reading = { light: now(), playing: false, still: still() };
  return reading;
}

function getServerSnapshot(): Reading | null {
  return null;
}

function useReading(): Reading | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ---------- the words ---------- */

/**
 * Completes “Photographer and developer in Boston” with Boston's light. Before
 * hydration it renders a full stop; the pre-paint script swaps that, in CSS, for
 * the same words this component renders, so nothing changes when it takes over.
 */
export function LiveClause() {
  const r = useReading();
  if (!r) {
    return (
      <span className={s.pending}>
        <span className={s.stop}>.</span>
      </span>
    );
  }
  const { now: w } = kit.words(r.light);
  const time = r.still ? (
    <time dateTime={r.light.clock.iso}>{w.time}</time>
  ) : (
    <button
      type="button"
      className={s.play}
      onClick={toggle}
      aria-pressed={r.playing}
    >
      <time dateTime={r.light.clock.iso}>{w.time}</time>
      <span className={s.hidden}>, play Boston&rsquo;s next 24 hours of light</span>
    </button>
  );
  return (
    <>
      ,
      <span className={s.now}>
        {w.pre}
        {time}
        {w.post}
      </span>
    </>
  );
}

/** “Sunset in Boston today: 5:43 pm.” */
export function LiveSignoff() {
  const r = useReading();
  if (!r) return <span className={s.pendingNext} />;
  const { next: w } = kit.words(r.light);
  return (
    <span>
      {w.pre}
      <time dateTime={r.light.next.iso}>{w.time}</time>
      {w.post}
    </span>
  );
}
