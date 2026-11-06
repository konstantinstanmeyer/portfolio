"use client";

import { useEffect } from "react";

/**
 * Rangefinder coincidence, scroll half.
 *
 * Short lines marked `data-focus` start sharp. Once the reader scrolls, a
 * line approaching the bottom of the frame from below, still out of sight, is
 * "armed": CSS draws a faint copy of it a little to its right. When the line
 * enters the frame the copy slides into coincidence, once, and stays there.
 *
 * Lines already in view, or above it, are never touched, so nothing on
 * screen ever falls out of focus and scrolling back up never re-doubles
 * anything. Without JavaScript, or with reduced motion, every line is sharp.
 */
export function Coincidence() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const lines = document.querySelectorAll<HTMLElement>("[data-focus]");

    // The moment it touches the frame: resolve. The easing holds the double
    // image for a beat before it moves, so it is seen, and a line can never be
    // left doubled on screen once scrolling stops.
    const focus = new IntersectionObserver((entries) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting || target.getAttribute("data-focus") !== "armed") continue;
        target.setAttribute("data-focus", "in");
        focus.unobserve(target);
      }
    });

    // Within a third of a frame below the bottom edge: arm, unseen.
    const arm = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, target, boundingClientRect } of entries) {
          if (!isIntersecting || target.getAttribute("data-focus") !== "") continue;
          arm.unobserve(target);
          // Still below the visible frame: double it and wait. Anything that
          // arrived some other way (a jump, or from above) simply stays sharp.
          if (boundingClientRect.top >= window.innerHeight) {
            target.setAttribute("data-focus", "armed");
            focus.observe(target);
          } else {
            target.setAttribute("data-focus", "seen");
          }
        }
      },
      { rootMargin: "0px 0px 35% 0px" },
    );

    // Nothing is armed until the reader first scrolls, so a page at rest, or
    // captured whole, never holds a doubled line.
    const start = () => {
      const vh = window.innerHeight;
      for (const el of lines) {
        // In view or above it now: leave it sharp for good.
        if (el.getBoundingClientRect().top < vh) el.setAttribute("data-focus", "seen");
        else arm.observe(el);
      }
    };
    window.addEventListener("scroll", start, { once: true, passive: true });

    return () => {
      window.removeEventListener("scroll", start);
      arm.disconnect();
      focus.disconnect();
    };
  }, []);

  return null;
}
