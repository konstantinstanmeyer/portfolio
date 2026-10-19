"use client";

import { useEffect, useState } from "react";
import {
  onPerformanceChange,
  probeFrameRate,
  softwareRendering,
  type PerformanceNote,
} from "./performance-notes";

const MESSAGES: Record<PerformanceNote, string> = {
  reduced: "Reduced motion is on, so the dots hold still.",
  software: "Hardware graphics are off in this browser, so fewer dots are drawn.",
  throttled: "Your browser is limiting animation (Low Power Mode or a battery saver), so motion may look choppy.",
};
const ORDER: PerformanceNote[] = ["reduced", "software", "throttled"];
// Frames are timed once the page's own intro has settled.
const PROBE_AFTER_MS = 3000;
// The note waits this long, so it doesn't compete with the page coming in.
const SHOW_AFTER_MS = 2500;
const DISMISSED_KEY = "performance-notice-dismissed";

function readDismissed(): string {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * A quiet note in the corner when something is holding the site's motion
 * back: the visitor's reduced-motion setting, no hardware graphics, or a
 * browser capping the frame rate. Dismissed, it stays away for the visit
 * unless something new comes up.
 */
export default function PerformanceNotice() {
  const [notes, setNotes] = useState<PerformanceNote[]>([]);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let throttled = false;
    const update = () => {
      const next = new Set<PerformanceNote>();
      if (motion.matches) next.add("reduced");
      if (softwareRendering()) next.add("software");
      // With reduced motion there's little left to look choppy.
      if (throttled && !motion.matches) next.add("throttled");
      setNotes(ORDER.filter((note) => next.has(note)));
    };
    motion.addEventListener("change", update);
    const release = onPerformanceChange(update);

    let probe: ReturnType<typeof probeFrameRate> | null = null;
    const probeTimer = window.setTimeout(() => {
      probe = probeFrameRate();
      probe.result.then((slow) => {
        throttled = slow;
        update();
      });
    }, PROBE_AFTER_MS);
    const showTimer = window.setTimeout(() => {
      update();
      setDismissed(readDismissed());
      setReady(true);
    }, SHOW_AFTER_MS);

    return () => {
      motion.removeEventListener("change", update);
      release();
      window.clearTimeout(probeTimer);
      window.clearTimeout(showTimer);
      probe?.cancel();
    };
  }, []);

  const key = notes.join(",");
  if (!ready || notes.length === 0 || dismissed === null || dismissed === key) return null;

  const dismiss = () => {
    setDismissed(key);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, key);
    } catch {
      // Not remembered past this page; it still goes away now.
    }
  };

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-30 flex max-w-[22rem] items-start gap-3 rounded-md border border-ink/15 bg-paper/85 px-3.5 py-2.5 text-[12.5px] leading-snug text-ink/70 backdrop-blur-sm motion-safe:animate-[notice-in_600ms_ease_both] max-sm:left-4"
    >
      <div className="flex flex-col gap-1">
        {notes.map((note) => (
          <p key={note}>{MESSAGES[note]}</p>
        ))}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mt-0.5 -mr-1 shrink-0 rounded px-1 text-[15px] leading-none text-ink/50 hover:text-ink/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ink/60"
      >
        ×
      </button>
    </div>
  );
}
