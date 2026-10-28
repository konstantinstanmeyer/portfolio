"use client";

import { useEffect } from "react";

const clamp = (n: number) => Math.max(-1, Math.min(1, n));

/**
 * Angular parallax. The viewing angle, from the pointer (or, on phones that
 * allow it without asking, the tilt of the phone), is written to `--ax` and
 * `--ay` on the page, each from -1 to 1. CSS moves the layers by it, each by
 * its own depth; the photographs, furthest away, the other way. The
 * properties are registered and transition, so the layers settle with a
 * little weight rather than tracking every pixel.
 */
export function Parallax() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const root = document.querySelector<HTMLElement>('[data-draft="focus"]');
    if (!root) return;

    let frame = 0;
    const set = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--ax", clamp(x).toFixed(3));
        root.style.setProperty("--ay", clamp(y).toFixed(3));
      });
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => set(0, 0);

    // Tilt, measured from however the phone was first held. Phones that ask
    // permission for it (iOS) are left still rather than prompted.
    let level: number | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      level ??= e.beta;
      set(e.gamma / 20, (e.beta - level) / 20);
    };
    const tilt =
      window.matchMedia("(pointer: coarse)").matches &&
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission !== "function";

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    if (tilt) window.addEventListener("deviceorientation", onTilt);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, []);

  return null;
}
