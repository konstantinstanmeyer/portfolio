"use client";

import { useEffect } from "react";

// The focus line, as a share of the frame's height: where the name rests on load.
const FOCUS = 0.42;
// Within this distance of the focus line (in frame heights) a plane is sharp and flat.
const BAND = 0.12;
// How far each frame closes on its target: the weight of the camera.
const EASE = 0.12;

const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));

/**
 * The page as a space you move through. Every block marked `data-plane` is a
 * plane at some depth: the further its centre is from the focus line, above
 * or below, the further it recedes, the more it tilts away, and the softer it
 * gets, as it would through a lens wide open. A plane the page can't scroll
 * onto the line (the first ones, the last ones) is sharpest as near to it as
 * the page goes: at rest, or at the very bottom. Each frame writes the plane's
 * distance as `--d` (signed) and `--ad`, eased so the planes trail the scroll
 * and settle; and `--v`, the scroll's speed, tips the whole space a little
 * while it moves. CSS does the rest.
 *
 * Positions are measured once (and on resize) with the planes flat, so a
 * plane's tilt never feeds back into where it is measured to be. Without
 * JavaScript, or with reduced motion, nothing moves and nothing softens.
 */
export function Space() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const root = document.querySelector<HTMLElement>('[data-draft="focus"]');
    if (!root) return;
    const planes = Array.from(root.querySelectorAll<HTMLElement>("[data-plane]"));

    let height = window.innerHeight;
    // The scroll at which each plane is sharpest.
    let sharpAt: number[] = [];
    const measure = () => {
      root.dataset.measuring = "";
      height = window.innerHeight;
      const end = Math.max(0, document.documentElement.scrollHeight - height);
      sharpAt = planes.map((el) => {
        const r = el.getBoundingClientRect();
        // The opening's own planes (data-rest) are sharpest at rest, wherever
        // the frame sets them: on a phone, centred, below the line.
        if (el.hasAttribute("data-rest")) return 0;
        return clamp(r.top + window.scrollY + r.height / 2 - FOCUS * height, 0, end);
      });
      delete root.dataset.measuring;
      root.dataset.space = "on";
    };

    // Everything starts in focus and settles into depth.
    const shown = planes.map(() => 0);
    let speed = 0;
    let lastY = window.scrollY;
    let frame = 0;

    const tick = () => {
      frame = 0;
      const y = window.scrollY;
      speed += (clamp(((y - lastY) / height) * 9) - speed) * 0.16;
      lastY = y;
      let settled = Math.abs(speed) < 0.002;

      // A field being typed in pulls its plane into focus, flat, wherever it is.
      const active = document.activeElement;
      const typing = active?.matches("input, textarea, select") ? active : null;

      planes.forEach((el, i) => {
        const d = (sharpAt[i] - y) / height;
        // Flat and sharp within the band; depth only beyond it.
        const target = typing && el.contains(typing) ? 0 : Math.sign(d) * Math.max(0, Math.abs(d) - BAND);
        const next = shown[i] + (target - shown[i]) * EASE;
        shown[i] = Math.abs(target - next) < 0.0004 ? target : next;
        if (shown[i] !== target) settled = false;
        el.style.setProperty("--d", shown[i].toFixed(4));
        el.style.setProperty("--ad", Math.abs(shown[i]).toFixed(4));
      });

      root.style.setProperty("--v", (settled ? 0 : speed).toFixed(4));
      if (!settled) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onResize = () => {
      measure();
      wake();
    };

    // The page changes height when a message grows or an error appears.
    const resized = new ResizeObserver(onResize);

    // In development, ?fringe=2 (or any multiple) scales the colour of
    // defocus, to judge its strength on a given screen.
    if (process.env.NODE_ENV !== "production") {
      const fringe = new URLSearchParams(window.location.search).get("fringe");
      if (fringe) root.style.setProperty("--fringe-k", fringe);
    }

    measure();
    wake();
    void document.fonts?.ready.then(onResize);
    resized.observe(root);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("focusin", wake);
    document.addEventListener("focusout", wake);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("focusin", wake);
      document.removeEventListener("focusout", wake);
      delete root.dataset.space;
      delete root.dataset.measuring;
    };
  }, []);

  return null;
}
