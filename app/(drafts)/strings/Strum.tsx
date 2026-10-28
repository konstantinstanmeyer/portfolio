"use client";

import { useEffect } from "react";

// Three damped cycles (T19). The string moves; the type never does.
const PLUCK = "linear(0, 1 10%, -0.7 25%, 0.45 40%, -0.25 55%, 0.1 70%, 0)";

/**
 * The two behaviours that need JavaScript, both optional:
 * - strings below the fold draw in from the left when they scroll into view;
 * - on a fine pointer, crossing any string plucks it, so moving across the
 *   staff strums it.
 * Renders nothing. Without it the page is already in its final state.
 */
export function Strum() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-draft='strings']");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cleanups: Array<() => void> = [];

    // 1. Draw-in. Strings already on screen (or above it) stay drawn; only
    //    those still below the fold are armed, so nothing visible flickers.
    if ("IntersectionObserver" in window) {
      const seen = new WeakSet<Element>();
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            if (!seen.has(el)) {
              seen.add(el);
              if (entry.boundingClientRect.top < window.innerHeight) io.unobserve(el);
              else el.dataset.draw = "armed";
            } else if (entry.isIntersecting) {
              el.dataset.draw = "in";
              io.unobserve(el);
            }
          }
        },
        { rootMargin: "0px 0px -64px 0px" },
      );
      root.querySelectorAll<HTMLElement>("[data-draw]").forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    }

    // 2. Pluck. A string rings when the pointer crosses its line within its
    //    length; several crossed in one move ring in order, like a strum.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (fine.matches && CSS.supports("animation-timing-function", PLUCK)) {
      const strings = Array.from(root.querySelectorAll<HTMLElement>("[data-string]"));
      let last: number | null = null;

      const pluck = (row: HTMLElement, delay: number) => {
        row.querySelectorAll<HTMLElement>("[data-seg]").forEach((seg) => {
          if (seg.dataset.draw === "armed") return;
          seg.animate([{ translate: "0 0" }, { translate: "0 -1.5px" }], { duration: 420, delay, easing: PLUCK });
          seg.animate([{ borderTopColor: "var(--ink-2)" }, { borderTopColor: "var(--string)" }], {
            duration: 750,
            delay,
            easing: "ease-out",
          });
        });
      };

      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        const x = e.clientX;
        const y = e.clientY;
        const from = last;
        last = y;
        if (from === null || from === y) return;
        const down = y > from;
        const hits: Array<{ row: HTMLElement; at: number }> = [];
        for (const row of strings) {
          const r = row.getBoundingClientRect();
          const at = r.top + 10.5;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          if ((from - at) * (y - at) < 0 && x >= r.left && x <= r.right) hits.push({ row, at });
        }
        hits.sort((a, b) => (down ? a.at - b.at : b.at - a.at)).forEach(({ row }, i) => pluck(row, i * 18));
      };
      const reset = () => {
        last = null;
      };

      document.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("scroll", reset, { passive: true });
      document.documentElement.addEventListener("pointerleave", reset);
      cleanups.push(() => {
        document.removeEventListener("pointermove", onMove);
        window.removeEventListener("scroll", reset);
        document.documentElement.removeEventListener("pointerleave", reset);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
