"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { loadPortrait, PORTRAIT } from "./portrait-dots";
import type { Area } from "./stipple/raster";
import styles from "./portrait.module.css";

// The photograph's glow under the cursor reaches this far (CSS px).
const LENS = 80;

/** Draws the photo, cut out by its matte, as CSS would with object-fit: cover. */
function paintCover(canvas: HTMLCanvasElement, tone: HTMLImageElement, matte: HTMLImageElement, area: Area) {
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cover = Math.max(canvas.width / tone.naturalWidth, canvas.height / tone.naturalHeight);
  const dw = tone.naturalWidth * cover;
  const dh = tone.naturalHeight * cover;
  const x = (canvas.width - dw) * PORTRAIT.posX;
  const y = (canvas.height - dh) * PORTRAIT.posY;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tone, x, y, dw, dh);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(matte, x, y, dw, dh);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * The frame the portrait's dots are drawn in (they move with the name's; see
 * portrait-dots.ts): its accessible description, and the photograph glowing
 * faintly through under a hovering cursor, toned to the dots.
 */
export default function Portrait({ area }: { area: Area }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadPortrait().then(
      ({ tone, matte }) => {
        if (!cancelled && photoRef.current) paintCover(photoRef.current, tone, matte, area);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [area]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // The frame lets the pointer through to the name's canvas, so the glow follows it from here.
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = frame.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      frame.style.setProperty("--lx", `${x}px`);
      frame.style.setProperty("--ly", `${y}px`);
      frame.toggleAttribute("data-lens", x >= 0 && y >= 0 && x <= r.width && y <= r.height);
    };
    const onLeave = () => frame.removeAttribute("data-lens");
    // While pressed, the dots gather into the bloom; the glow steps aside.
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) frame.setAttribute("data-held", "");
    };
    const onUp = () => frame.removeAttribute("data-held");
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("blur", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      role="img"
      aria-label="Konstantin raising a small rangefinder camera to his eye, drawn in dots."
      className={styles.frame}
      style={
        {
          left: area.left,
          top: area.top,
          width: area.width,
          height: area.height,
          "--lens": `${LENS}px`,
        } as CSSProperties
      }
    >
      <canvas ref={photoRef} aria-hidden="true" className={styles.photo} />
    </div>
  );
}
