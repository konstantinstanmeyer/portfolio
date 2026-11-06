"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import s from "./focus.module.css";

type Frame = { src: StaticImageData; alt: string };

// Columns across at each stage of a tile's reveal: one flat pixel of the
// photograph's average colour, then ever finer blocks, then the photograph.
const TILE_STEPS = [1, 2, 4, 8, 16, 32];
// The enlarged photograph resolves the same way, from finer blocks.
const LOUPE_STEPS = [12, 24, 48, 96];
const STEP_MS = 70;
// Tiles appear one by one in a random order, this far apart.
const STAGGER_MS = 45;
// Each holds its single pixel for a random while before it resolves.
const HOLD_MS: [number, number] = [260, 1100];

const pad = (n: number) => String(n).padStart(2, "0");

// The enlarged photograph's width, as `.loupe img` sets it: the frame's width
// less its margins, or its height less margins and caption times the
// photograph's ratio, whichever is smaller. The margins are --m.
function loupeSizes(ratio: number) {
  const width = (m: string) =>
    `min(1280px, calc(100vw - 2 * ${m}), calc((100vh - 2 * ${m} - 40px) * ${ratio.toFixed(3)}))`;
  return `(max-width: 959.98px) ${width("clamp(24px, 6.25vw, 64px)")}, ${width("clamp(24px, 6.667vw, 96px)")}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const still = () => !window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/**
 * Draws `img`, cropped to cover the canvas, as `cols` blocks across (and as
 * many down as keep them square). The photograph is shrunk with smoothing,
 * so each block is the average of what it covers, then enlarged without.
 */
function pixelate(canvas: HTMLCanvasElement, img: HTMLImageElement, cols: number, scratch: HTMLCanvasElement) {
  const { width: W, height: H } = canvas;
  const rows = Math.max(1, Math.round((cols * H) / W));
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let sw = iw;
  let sh = ih;
  if (iw / ih > W / H) sw = (ih * W) / H;
  else sh = (iw * H) / W;
  scratch.width = cols;
  scratch.height = rows;
  const small = scratch.getContext("2d")!;
  small.imageSmoothingEnabled = true;
  small.imageSmoothingQuality = "high";
  small.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cols, rows);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, cols, rows, 0, 0, W, H);
}

/**
 * The file `img` is showing, as a plain image. A responsive image reports its
 * size scaled for the screen's density, but a canvas reads its real pixels,
 * so crops are measured on this copy instead. It comes from the cache.
 */
async function pixelsOf(img: HTMLImageElement): Promise<HTMLImageElement | null> {
  await img.decode().catch(() => {});
  const src = img.currentSrc || img.src;
  if (!src) return null;
  const plain = document.createElement("img");
  plain.src = src;
  await plain.decode().catch(() => {});
  return plain.naturalWidth ? plain : null;
}

/** A canvas laid over `box`, at its device-pixel size. */
function overlay(box: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const r = box.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.className = s.pixels;
  canvas.setAttribute("aria-hidden", "true");
  box.append(canvas);
  return canvas;
}

/** One tile: its pixel, a pause, then each finer stage, then the photograph. */
async function resolveTile(tile: HTMLElement, hold: number) {
  const img = tile.querySelector("img");
  const source = img && (await pixelsOf(img));
  if (!source || !tile.isConnected) {
    tile.dataset.state = "shown";
    return;
  }
  const canvas = overlay(tile);
  const scratch = document.createElement("canvas");
  tile.dataset.state = "pixel";
  for (let i = 0; i < TILE_STEPS.length; i++) {
    pixelate(canvas, source, TILE_STEPS[i], scratch);
    await wait(i === 0 ? hold : STEP_MS);
  }
  tile.dataset.state = "shown";
  canvas.remove();
}

/**
 * The photographs: twenty small frames, five by four, with nothing between
 * them, like the pixels of one picture. When the sheet comes into focus they
 * appear in a random order, each first as a single pixel of its own average
 * colour, and each resolves into its photograph at its own moment. A frame
 * opens large; it resolves the same way while the full photograph loads.
 *
 * Without JavaScript, or with reduced motion, the photographs simply show.
 */
export function Contact({ frames }: { frames: Frame[] }) {
  const sheet = useRef<HTMLOListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const loupe = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // Whether the pointer went down on the dialog's own ground, outside the photograph.
  const pressedOutside = useRef(false);
  const [open, setOpen] = useState<number | null>(null);

  // The reveal, once: when most of the sheet is in the frame (as much as the
  // frame can hold, on a screen shorter than the sheet), or when any of it has
  // rested in view for a moment, so a jump that lands short still plays it.
  useEffect(() => {
    const list = sheet.current;
    if (!list || still() || !("IntersectionObserver" in window)) return;
    list.dataset.reveal = "armed";
    const tiles = Array.from(list.querySelectorAll<HTMLElement>("[data-tile]"));
    const enough = Math.min(0.75, (0.95 * window.innerHeight) / Math.max(1, list.offsetHeight));
    let settle = 0;
    const play = () => {
      io.disconnect();
      window.clearTimeout(settle);
      const order = tiles.map((_, i) => i).sort(() => Math.random() - 0.5);
      order.forEach((t, k) => {
        const hold = HOLD_MS[0] + Math.random() * (HOLD_MS[1] - HOLD_MS[0]);
        window.setTimeout(() => void resolveTile(tiles[t], hold), k * STAGGER_MS);
      });
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(settle);
        if (!entry.isIntersecting) return;
        if (entry.intersectionRatio >= enough) play();
        else settle = window.setTimeout(play, 900);
      },
      { threshold: [0, 0.1, 0.25, 0.5, enough, 1] },
    );
    io.observe(list);
    return () => {
      io.disconnect();
      window.clearTimeout(settle);
    };
  }, []);

  // Opening: show the dialog, and resolve the large photograph from the
  // small one already on the sheet while the full one loads.
  useEffect(() => {
    const d = dialog.current;
    const box = loupe.current;
    if (open === null || !d || !box) return;
    if (!d.open) {
      d.showModal();
      close.current?.focus();
    }
    const big = box.querySelector("img");
    const small = sheet.current?.querySelectorAll<HTMLElement>("[data-tile]")[open]?.querySelector("img");
    if (!big || still() || !small?.complete || !small.naturalWidth) {
      box.dataset.state = "shown";
      return;
    }
    let cancelled = false;
    const canvas = overlay(box);
    const scratch = document.createElement("canvas");
    box.dataset.state = "pixel";
    const loaded = big.complete && big.naturalWidth ? Promise.resolve() : big.decode().catch(() => {});
    (async () => {
      const source = await pixelsOf(small);
      for (const cols of source ? LOUPE_STEPS : []) {
        if (cancelled) return;
        pixelate(canvas, source!, cols, scratch);
        await wait(STEP_MS);
      }
      await loaded;
      if (cancelled) return;
      box.dataset.state = "shown";
      canvas.remove();
    })();
    return () => {
      cancelled = true;
      canvas.remove();
    };
  }, [open]);

  const step = (by: number) => setOpen((i) => (i === null ? i : (i + by + frames.length) % frames.length));

  return (
    <>
      <ol className={s.sheet} ref={sheet} data-plane="" data-sheet="">
        {frames.map(({ src, alt }, i) => (
          <li className={s.tile} key={src.src} data-tile="">
            {/* A link to the full photograph, opened in place when scripts run. */}
            <a
              href={src.src}
              className={s.open}
              onClick={(e) => {
                e.preventDefault();
                setOpen(i);
              }}
            >
              <span className={s.vh}>Enlarge photograph {i + 1}: </span>
              <Image src={src} alt={alt} sizes="(min-width: 1600px) 164px, (min-width: 960px) 11vw, 20vw" />
            </a>
          </li>
        ))}
      </ol>

      <dialog
        ref={dialog}
        className={s.dialog}
        aria-label="Photograph"
        aria-describedby="loupe-description"
        onClose={() => setOpen(null)}
        onPointerDown={(e) => {
          pressedOutside.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          // A click on the ground around the photograph closes it; one that
          // started on the photograph or a control and slipped off does not.
          if (pressedOutside.current && e.target === e.currentTarget) e.currentTarget.close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
      >
        {open !== null && (
          <figure className={s.figure}>
            <p id="loupe-description" className={s.vh} aria-live="polite">
              Photograph {open + 1} of {frames.length}. {frames[open].alt}
            </p>
            {/* Sized from the photograph's own ratio, so the frame is set before it loads. */}
            <div
              className={s.loupe}
              ref={loupe}
              key={open}
              style={{ "--ratio": frames[open].src.width / frames[open].src.height } as CSSProperties}
            >
              <Image
                src={frames[open].src}
                alt={frames[open].alt}
                sizes={loupeSizes(frames[open].src.width / frames[open].src.height)}
                loading="eager"
              />
            </div>
            <figcaption className={s.caption}>
              <span className={s.count}>
                {pad(open + 1)} / {pad(frames.length)}
              </span>
              <span className={s.controls}>
                <button type="button" onClick={() => step(-1)}>
                  Previous
                </button>
                <button type="button" onClick={() => step(1)}>
                  Next
                </button>
                <button type="button" ref={close} onClick={() => dialog.current?.close()}>
                  Close
                </button>
              </span>
            </figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}
