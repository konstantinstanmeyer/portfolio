"use client";

import { useEffect, useRef, useState } from "react";
import { InkFluid } from "./engine/fluid";
import { fontOf, rasterizeHeading } from "./engine/raster";
import { MessageLine } from "./message-line";
import styles from "./ink.module.css";

type Track = { x: number; y: number; t: number; sx: number; sy: number; moved: number };

export function InkLanding() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const fluidRef = useRef<InkFluid | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const h1 = nameRef.current;
    if (!canvas || !h1) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dprCap = 2;
    const fluid = InkFluid.create(canvas, reduced, {
      onFirstFrame: () => setLive(true),
      onLost: () => setLive(false),
      onSlow: () => {
        if (Math.min(window.devicePixelRatio || 1, dprCap) <= 1) return;
        dprCap = 1;
        scheduleLayout();
      },
    });
    if (!fluid) return;
    fluidRef.current = fluid;

    let disposed = false;
    let ready = false;
    let frame = 0;
    const stamp = document.createElement("canvas");

    const layout = () => {
      frame = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      fluid.resize(canvas.clientWidth, canvas.clientHeight, dpr);
      const r = rasterizeHeading(h1, dpr, stamp);
      if (r) fluid.setName(r.canvas, r.rect, r.size);
    };
    const scheduleLayout = () => {
      if (!ready || frame) return;
      frame = requestAnimationFrame(layout);
    };

    const font = fontOf(h1);
    Promise.all([document.fonts.load(font, "Konstantin Stanmeyer"), document.fonts.ready])
      .catch(() => undefined)
      .then(() => {
        if (disposed) return;
        ready = true;
        layout();
        if (!document.hidden) fluid.start();
      });

    const tracks = new Map<number, Track>();
    const inForm = (t: EventTarget | null) => t instanceof Element && t.closest("form") !== null;

    const onMove = (e: PointerEvent) => {
      const tr = tracks.get(e.pointerId);
      if (!tr) {
        if (e.pointerType === "mouse") {
          tracks.set(e.pointerId, { x: e.clientX, y: e.clientY, t: 0, sx: 0, sy: 0, moved: 99 });
        }
        return;
      }
      const dx = e.clientX - tr.x;
      const dy = e.clientY - tr.y;
      tr.x = e.clientX;
      tr.y = e.clientY;
      tr.moved = Math.max(tr.moved, Math.hypot(e.clientX - tr.sx, e.clientY - tr.sy));
      if (dx || dy) fluid.stir(e.clientX, e.clientY, dx, dy);
    };
    const onDown = (e: PointerEvent) => {
      if (inForm(e.target)) return;
      tracks.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        sx: e.clientX,
        sy: e.clientY,
        moved: 0,
      });
    };
    const onUp = (e: PointerEvent) => {
      const tr = tracks.get(e.pointerId);
      if (!tr) return;
      if (tr.t && tr.moved < 10 && performance.now() - tr.t < 450 && !inForm(e.target)) {
        fluid.drop(e.clientX, e.clientY);
      }
      if (e.pointerType === "mouse") tr.t = 0;
      else tracks.delete(e.pointerId);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && !e.relatedTarget) tracks.delete(e.pointerId);
    };
    const onCancel = (e: PointerEvent) => tracks.delete(e.pointerId);
    const onVisibility = () => {
      if (document.hidden) fluid.stop();
      else if (ready) fluid.start();
    };

    const ro = new ResizeObserver(scheduleLayout);
    ro.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    document.addEventListener("pointerout", onLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("pointerout", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      fluid.dispose();
      fluidRef.current = null;
    };
  }, []);

  return (
    <main className={styles.root} data-live={live}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <h1 ref={nameRef} className={styles.name}>
        Konstantin <br className={styles.brk} />
        Stanmeyer
      </h1>
      <MessageLine fluid={fluidRef} />
    </main>
  );
}
