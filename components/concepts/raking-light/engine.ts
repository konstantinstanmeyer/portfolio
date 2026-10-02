import type { SlotBridge } from "./bridge";
import { bake, createProgram, createTexture, uniformMap } from "./gl/gl";
import { FULLSCREEN_VS, PAPER_HEIGHT_FS, PAPER_SLOPE_FS, SURFACE_FS } from "./gl/shaders";
import { measureLayout, type Layout, type Rect } from "./layout";
import { LightRig } from "./light";
import { signedDistance } from "./sdf";
import { TypeLayer } from "./type-layer";

const UNIFORMS = [
  "uRes", "uScale", "uEps",
  "uName", "uNameBox", "uNameProf",
  "uType", "uSlot", "uTypeDepth", "uLine", "uCaret", "uRoller",
  "uPaper", "uGrain",
  "uLight", "uLightCol", "uLightReach", "uLightSize",
  "uFillDir", "uFillCol", "uAlbedo", "uExposure", "uMaxH", "uReach",
] as const;

type NameField = { data: Float32Array; w: number; h: number; box: Rect };

const SPREAD = 12;
/** +1 embossed (raised), -1 debossed (pressed in). */
const RELIEF = -1;

function buildNameField(L: Layout, dpr: number): NameField | null {
  const m = SPREAD + 4;
  const bx = L.nameBox.x - m;
  const by = L.nameBox.y - m;
  const bw = L.nameBox.w + m * 2;
  const bh = L.nameBox.h + m * 2;
  const scale = Math.min(Math.max(dpr, 1), 2, 2048 / bw, 1024 / bh);
  const w = Math.ceil(bw * scale);
  const h = Math.ceil(bh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(scale, 0, 0, scale, -bx * scale, -by * scale);
  ctx.font = L.nameFont;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  for (const g of L.glyphs) ctx.fillText(g.ch, g.x, g.y);
  const data = signedDistance(ctx.getImageData(0, 0, w, h).data, w, h, scale, SPREAD);
  return { data, w, h, box: { x: bx, y: by, w: w / scale, h: h / scale } };
}

type GL = {
  gl: WebGL2RenderingContext;
  surface: WebGLProgram;
  u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  vao: WebGLVertexArrayObject;
  paper: WebGLTexture;
  name: WebGLTexture;
  type: WebGLTexture;
};

function initGL(gl: WebGL2RenderingContext): GL {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const heightProg = createProgram(gl, FULLSCREEN_VS, PAPER_HEIGHT_FS);
  const slopeProg = createProgram(gl, FULLSCREEN_VS, PAPER_SLOPE_FS);
  const height = bake(gl, heightProg, 1024, null);
  const paper = bake(gl, slopeProg, 1024, height);
  gl.deleteTexture(height);
  gl.deleteProgram(heightProg);
  gl.deleteProgram(slopeProg);
  gl.bindTexture(gl.TEXTURE_2D, paper);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);

  const surface = createProgram(gl, FULLSCREEN_VS, SURFACE_FS);
  const name = createTexture(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([SPREAD]));
  const type = createTexture(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const u = uniformMap(gl, surface, UNIFORMS);
  gl.useProgram(surface);
  gl.uniform1i(u.uName, 0);
  gl.uniform1i(u.uType, 1);
  gl.uniform1i(u.uPaper, 2);
  return { gl, surface, u, vao, paper, name, type };
}

function uploadName(g: GL, field: NameField) {
  const { gl } = g;
  gl.bindTexture(gl.TEXTURE_2D, g.name);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, field.w, field.h, 0, gl.RED, gl.FLOAT, field.data);
}

function disposeGL(g: GL) {
  const { gl } = g;
  gl.deleteProgram(g.surface);
  gl.deleteVertexArray(g.vao);
  gl.deleteTexture(g.paper);
  gl.deleteTexture(g.name);
  gl.deleteTexture(g.type);
}

/** Starts the renderer; returns a cleanup function. Without WebGL2 the CSS relief stays. */
export function mountEngine(root: HTMLElement, canvas: HTMLCanvasElement, bridge: SlotBridge): () => void {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "default",
  });
  if (!gl) return () => {};

  let g: GL | null = null;
  try {
    g = initGL(gl);
  } catch (err) {
    console.warn(err);
    return () => {};
  }

  const light = new LightRig();
  const type = new TypeLayer();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motion.matches;
  let layout: Layout | null = null;
  let field: NameField | null = null;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let alive = true;
  let ready = false;
  let dirty = true;
  let rebuildTimer = 0;
  let fontsReady = false;
  let typeFresh = true;
  let bornAt = -1;
  let frameNo = 0;

  const rebuildName = () => {
    rebuildTimer = 0;
    if (!layout || !g) return;
    field = buildNameField(layout, dpr);
    if (field) uploadName(g, field);
    dirty = true;
  };

  const relayout = () => {
    if (!fontsReady) return;
    const next = measureLayout(root);
    if (!next) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(next.width * dpr));
    const ch = Math.max(1, Math.round(next.height * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const changed = !layout || layout.signature !== next.signature;
    layout = next;
    type.layout(next, dpr);
    if (changed) {
      if (!field) rebuildName();
      else {
        window.clearTimeout(rebuildTimer);
        rebuildTimer = window.setTimeout(rebuildName, 140);
      }
    }
    dirty = true;
  };

  const draw = (now: number) => {
    if (!g || !layout || !field) return;
    const { gl: c, u } = g;
    const L = layout;
    c.viewport(0, 0, canvas.width, canvas.height);
    c.useProgram(g.surface);
    c.bindVertexArray(g.vao);
    c.activeTexture(c.TEXTURE0);
    c.bindTexture(c.TEXTURE_2D, g.name);
    c.activeTexture(c.TEXTURE1);
    c.bindTexture(c.TEXTURE_2D, g.type);
    c.activeTexture(c.TEXTURE2);
    c.bindTexture(c.TEXTURE_2D, g.paper);

    const scale = canvas.width / L.width;
    const size = L.nameSize;
    c.uniform2f(u.uRes, canvas.width, canvas.height);
    c.uniform1f(u.uScale, scale);
    c.uniform1f(u.uEps, Math.max(0.5, 0.75 / scale));
    c.uniform4f(u.uNameBox, field.box.x, field.box.y, field.box.w, field.box.h);
    const depth = RELIEF * Math.max(1.4, size * 0.024);
    c.uniform4f(u.uNameProf, depth, Math.max(1.6, size * 0.04), 0, SPREAD);
    c.uniform4f(u.uSlot, L.slot.x, L.slot.y, L.slot.w, L.slot.h);
    c.uniform1f(u.uTypeDepth, (1.0 / 0.8) * type.sink);
    c.uniform4f(u.uLine, L.textLeft - 6, L.mark.x - 16, L.slot.h - 7, 0.75);
    c.uniform4f(u.uCaret, type.caretX, type.caretDepth, L.slot.h * 0.24, 0);
    c.uniform2f(u.uRoller, type.rollerX, type.rollerAmp);
    c.uniform3f(u.uGrain, 1 / 1024 / 0.55, 0.17, 0.3);
    c.uniform3f(u.uLight, light.x, light.y, light.z);
    const on = bornAt < 0 ? 0 : Math.min(1, (now - bornAt) / 1.8);
    const warm = on * on * (3 - 2 * on);
    c.uniform3f(u.uLightCol, 5.6 * warm, 4.6 * warm, 3.5 * warm);
    c.uniform1f(u.uLightReach, Math.max(L.width, L.height) * 0.17);
    c.uniform1f(u.uLightSize, 26);
    c.uniform3f(u.uFillDir, 0.2, -0.95, 0.24);
    c.uniform3f(u.uFillCol, 0.035, 0.042, 0.06);
    c.uniform3f(u.uAlbedo, 0.042, 0.044, 0.05);
    c.uniform1f(u.uExposure, 1.0);
    c.uniform1f(u.uMaxH, Math.max(0.3, depth, size * 0.004));
    c.uniform1f(u.uReach, depth > 0 ? 96 : 8);
    c.drawArrays(c.TRIANGLES, 0, 3);
  };

  const frame = (ms: number) => {
    raf = requestAnimationFrame(frame);
    if (!g || !layout || !field) return;
    const now = ms / 1000;
    const dt = last ? Math.min(now - last, 0.12) : 1 / 60;
    last = now;

    for (let e = bridge.queue.shift(); e; e = bridge.queue.shift()) type.event(e, now);
    type.sync(bridge, now);
    light.update(dt, now, layout, reduced, bridge.focused);

    const redrawn = type.update(now, reduced);
    if (redrawn) {
      const c = g.gl;
      c.bindTexture(c.TEXTURE_2D, g.type);
      c.pixelStorei(c.UNPACK_ALIGNMENT, 4);
      if (type.takeResize() || typeFresh) c.texImage2D(c.TEXTURE_2D, 0, c.RGBA8, c.RGBA, c.UNSIGNED_BYTE, type.canvas);
      else c.texSubImage2D(c.TEXTURE_2D, 0, 0, 0, c.RGBA, c.UNSIGNED_BYTE, type.canvas);
      typeFresh = false;
    }

    const warming = bornAt < 0 || now - bornAt < 1.9;
    const busy = dirty || warming || redrawn || light.moving || type.rollerAmp > 0 || type.sink !== 1;
    // A breathing caret alone only needs half the frame rate.
    const idleCaret = type.caretDepth > 0 && (frameNo++ & 1) === 0;
    if (busy || idleCaret) {
      draw(now);
      dirty = false;
      if (!ready) {
        ready = true;
        bornAt = now;
        root.dataset.gl = "on";
      }
    }
  };

  const start = () => {
    if (!raf && alive && !document.hidden && !gl.isContextLost()) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const local = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e);
    if (e.pointerType === "touch") {
      if (e.buttons || e.pressure > 0) light.touch(x, y);
    } else light.pointer(x, y);
  };
  const onDown = (e: PointerEvent) => {
    const [x, y] = local(e);
    if (e.pointerType === "touch") light.touch(x, y);
    else {
      light.pointer(x, y);
      if (!(e.target instanceof Element && e.target.closest("[data-slot]"))) light.press(true);
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") light.release(performance.now() / 1000);
    else light.press(false);
  };
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) light.leave(performance.now() / 1000);
  };
  const onWheel = (e: WheelEvent) => light.wheel(e.deltaY);
  const onVisibility = () => (document.hidden ? stop() : start());
  const onMotion = () => {
    reduced = motion.matches;
    dirty = true;
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    stop();
    g = null;
  };
  const onRestored = () => {
    try {
      g = initGL(gl);
      if (field) uploadName(g, field);
      if (layout) type.layout(layout, dpr);
      typeFresh = true;
      dirty = true;
      start();
    } catch (err) {
      console.warn(err);
    }
  };

  const ro = new ResizeObserver(relayout);
  ro.observe(root);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });
  window.addEventListener("pointerout", onOut, { passive: true });
  root.addEventListener("wheel", onWheel, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", onMotion);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  const onFonts = () => relayout();
  document.fonts.addEventListener("loadingdone", onFonts);

  const words = root.querySelector<HTMLElement>("[data-word]");
  const input = root.querySelector<HTMLElement>("input[name=message]");
  const fonts = [words, input].filter((el): el is HTMLElement => !!el).map((el) => {
    const cs = getComputedStyle(el);
    return document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
  });
  Promise.all(fonts)
    .catch(() => undefined)
    .then(() => document.fonts.ready)
    .then(() => {
      if (!alive) return;
      fontsReady = true;
      relayout();
      start();
    });

  return () => {
    alive = false;
    stop();
    window.clearTimeout(rebuildTimer);
    ro.disconnect();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("pointerout", onOut);
    root.removeEventListener("wheel", onWheel);
    document.removeEventListener("visibilitychange", onVisibility);
    motion.removeEventListener("change", onMotion);
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    document.fonts.removeEventListener("loadingdone", onFonts);
    if (g && !gl.isContextLost()) disposeGL(g);
    g = null;
    delete root.dataset.gl;
  };
}
