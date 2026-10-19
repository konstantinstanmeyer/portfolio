// What's holding the site's motion back, for a quiet note to the visitor:
// reduced motion (their own setting), no hardware graphics (fewer dots, drawn
// on the CPU), or a browser limiting the frame rate (Low Power Mode, a battery
// saver). The dot renderer reports which way it draws; the rest is measured.

export type PerformanceNote = "reduced" | "software" | "throttled";

let software = false;
const listeners = new Set<() => void>();

/** The dot renderer reports how it draws (the 2D fallback means no hardware graphics). */
export function reportRenderer(kind: "webgl" | "2d"): void {
  if (kind !== "2d" || software) return;
  software = true;
  for (const listener of listeners) listener();
}

export function softwareRendering(): boolean {
  return software;
}

/** Calls `listener` when what's known changes; returns its release. */
export function onPerformanceChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Frames are timed for this long once the page has settled; a median frame
// longer than THROTTLED_MS means the browser is capping animation (about 30
// fps or slower, where the display runs at 60 or more).
const PROBE_FRAMES = 90;
const THROTTLED_MS = 26;

/** Times a burst of animation frames; resolves true if they come at 30 fps or slower. */
export function probeFrameRate(): { result: Promise<boolean>; cancel: () => void } {
  let raf = 0;
  let cancelled = false;
  const result = new Promise<boolean>((resolve) => {
    const gaps: number[] = [];
    let last = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      // A hidden tab pauses frames; those gaps aren't the browser's limit.
      if (document.hidden) {
        last = 0;
      } else {
        if (last) gaps.push(now - last);
        last = now;
      }
      if (gaps.length < PROBE_FRAMES) {
        raf = requestAnimationFrame(tick);
        return;
      }
      gaps.sort((a, b) => a - b);
      resolve(gaps[gaps.length >> 1] > THROTTLED_MS);
    };
    raf = requestAnimationFrame(tick);
  });
  return {
    result,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}
