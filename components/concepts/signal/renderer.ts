import type { SignalBridge } from "./bridge";
import {
  measureBox,
  measureName,
  paintBox,
  paintName,
  type BoxLayout,
  type Glyph,
  type NameLayout,
} from "./masks";
import { FRAGMENT, VERTEX } from "./shaders";

export type SignalElements = {
  root: HTMLElement;
  host: HTMLElement;
  name: HTMLElement;
  form: HTMLElement;
  input: HTMLInputElement;
  send: HTMLElement;
};

const UNIFORMS = [
  "uRes", "uTime", "uName", "uBox", "uBoxRect", "uLens",
  "uField", "uDrift", "uNameBox", "uAck", "uBoxA", "uBoxB", "uBoxC", "uMotion",
] as const;
type Uniform = (typeof UNIFORMS)[number];

const ACQUIRE_MS = 1600;
const TRANSMIT_MS = 1100;
const FEEDBACK_MS = 1900;
const ACK_MS = 1300;
const REVEAL_MS = 260;
const SHAKE_MS = 420;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const approach = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    console.error(gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeTexture(gl: WebGL2RenderingContext) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Starts the field. Returns a disposer. */
export function startSignal(el: SignalElements, bridge: SignalBridge): () => void {
  // A fresh canvas per mount, so a disposed (lost) context is never reused.
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  el.host.appendChild(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    canvas.remove();
    return () => {};
  }

  const nameCanvas = document.createElement("canvas");
  const nameCtx = nameCanvas.getContext("2d");
  const boxCanvas = document.createElement("canvas");
  const boxCtx = boxCanvas.getContext("2d");
  if (!nameCtx || !boxCtx) {
    canvas.remove();
    return () => {};
  }

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motionQuery.matches;

  let program: WebGLProgram | null = null;
  let nameTex: WebGLTexture | null = null;
  let boxTex: WebGLTexture | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const loc = {} as Record<Uniform, WebGLUniformLocation | null>;

  // Viewport, in CSS px unless noted. One grain = `grain` device px = one buffer px.
  let cssW = 1;
  let cssH = 1;
  let scale = 1;
  let bufW = 1;
  let bufH = 1;
  let name: NameLayout | null = null;
  let box: BoxLayout | null = null;
  let ready = false;
  let live = false;
  let alive = true;
  let raf = 0;
  let t0 = performance.now();
  let last = t0;

  // Pointer / tuning.
  let px = 0;
  let py = 0;
  let pActive = false;
  let pTouch = false;
  let pLast = -1e9;
  let tapAt = -1e9;
  let lensX = -1;
  let lensY = -1;
  let userW = 0;
  // Carrier drift per line; horizontal pointer motion over the name brushes it.
  let drift1 = 0;
  let drift2 = 0;
  let brush = 0;
  let pointerVx = 0;
  let coh = 0.92;

  // Message box.
  let hover = false;
  let quiet = 0;
  let sendA = 0;
  let boxSeen = -1;
  let boxText = "";
  let boxScroll = 0;
  let boxGlyph: Glyph = null;
  let feedbackSeen = -1e9;
  let feedbackShownAt = -1e9;
  let lastSel = -1;
  let lastInputAt = -1e9;

  function init(): boolean {
    if (!gl) return false;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return false;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) console.error(gl.getProgramInfoLog(p));
      return false;
    }
    program = p;
    gl.useProgram(p);
    for (const u of UNIFORMS) loc[u] = gl.getUniformLocation(p, u);
    gl.uniform1i(loc.uName, 0);
    gl.uniform1i(loc.uBox, 1);
    nameTex = makeTexture(gl);
    boxTex = makeTexture(gl);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    return true;
  }

  function uploadName() {
    if (!gl || !name) return;
    paintName(nameCanvas, nameCtx!, name, scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, nameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, nameCanvas);
  }

  function uploadBox() {
    if (!gl || !box) return;
    paintBox(boxCanvas, boxCtx!, box, scale, boxText, boxScroll, boxGlyph);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, boxTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, boxCanvas);
  }

  async function layout() {
    const nameFont = getComputedStyle(el.name);
    const boxFont = getComputedStyle(el.input);
    try {
      await Promise.all([
        document.fonts.load(`${nameFont.fontWeight} ${nameFont.fontSize} ${nameFont.fontFamily}`, "Konstantin Stanmeyer"),
        document.fonts.load(`${boxFont.fontWeight} ${boxFont.fontSize} ${boxFont.fontFamily}`, "0"),
      ]);
    } catch {
      // Fall through with whatever font is available.
    }
    if (!alive || !gl || gl.isContextLost()) return;

    const origin = el.root.getBoundingClientRect();
    cssW = origin.width;
    cssH = origin.height;
    // Grain = whole device pixels: ~1 CSS px on large screens, finer on phones.
    const dpr = window.devicePixelRatio || 1;
    const small = Math.min(cssW, cssH) < 640;
    const grain = Math.max(1, Math.round(small ? dpr / 2 : dpr));
    scale = Math.min(2, dpr / grain);
    bufW = Math.max(1, Math.ceil(cssW * scale));
    bufH = Math.max(1, Math.ceil(cssH * scale));
    canvas.width = bufW;
    canvas.height = bufH;
    canvas.style.width = `${bufW / scale}px`;
    canvas.style.height = `${bufH / scale}px`;
    nameCanvas.width = bufW;
    nameCanvas.height = bufH;

    name = measureName(el.name, origin, nameCtx!);
    box = measureBox(el.input, el.send, origin, boxCtx!);
    boxCanvas.width = Math.max(1, Math.round(box.rect.w * scale));
    boxCanvas.height = Math.max(1, Math.round(box.rect.h * scale));
    if (lensX < 0) {
      lensX = name.bounds.x + name.bounds.w * 0.5;
      lensY = name.bounds.y + name.bounds.h * 0.5;
    }
    gl.viewport(0, 0, bufW, bufH);
    uploadName();
    uploadBox();
    if (!ready) {
      ready = true;
      t0 = performance.now();
    }
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function syncBox(now: number, transmitting: boolean) {
    const input = el.input;
    const sel = input.selectionStart ?? input.value.length;
    const scroll = input.scrollLeft;
    const version = bridge.boxVersion;
    let dirty = false;
    if (version !== boxSeen && !transmitting) {
      boxSeen = version;
      boxText = input.value;
      lastInputAt = now;
      dirty = true;
    }
    if (scroll !== boxScroll) {
      boxScroll = scroll;
      dirty = true;
    }
    if (sel !== lastSel) {
      lastSel = sel;
      lastInputAt = now;
    }
    const glyph: Glyph = bridge.feedback && now - feedbackShownAt < FEEDBACK_MS ? bridge.feedback : null;
    if (glyph !== boxGlyph) {
      boxGlyph = glyph;
      dirty = true;
    }
    if (dirty) uploadBox();
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!gl || !program || !name || !box) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    const nb = name.bounds;

    // Autonomous tuner drifts across the name when nobody is steering.
    const ax = nb.x + nb.w * (0.5 + (reduced ? 0 : 0.42 * Math.sin(t * 0.19)));
    const ay = nb.y + nb.h * (0.5 + (reduced ? 0 : 0.34 * Math.sin(t * 0.31 + 1.2)));
    const steering = pActive && now - pLast < (pTouch ? 3200 : 9000);
    userW = approach(userW, steering ? 1 : 0, steering ? 5 : 0.5, dt);
    const tx = ax + (px - ax) * userW;
    const ty = ay + (py - ay) * userW;
    const follow = reduced ? 30 : pTouch ? 9 : 6;
    lensX = approach(lensX, tx, follow, dt);
    lensY = approach(lensY, ty, follow, dt);

    const dx = Math.max(nb.x - px, 0, px - (nb.x + nb.w));
    const dy = Math.max(nb.y - py, 0, py - (nb.y + nb.h));
    const near = 1 - smooth(0, Math.min(cssW, cssH) * 0.3, Math.hypot(dx, dy));
    const over = 1 - smooth(0, 60, Math.hypot(dx, dy));
    pointerVx = approach(pointerVx, 0, 5, dt);
    brush = approach(brush, reduced ? 0 : pointerVx * over * userW, 10, dt);
    const base = (reduced ? 2 : 34) * scale;
    drift1 += (base + brush * scale) * dt;
    drift2 += (-base + brush * scale) * dt;
    const pulse = Math.exp(-(now - tapAt) / 700);
    const floor = document.activeElement === el.input ? 0.7 : 0.26;
    const steered = Math.max(floor, 0.26 + 0.5 * near);
    const target = Math.min(1, 0.9 + (steered - 0.9) * userW + pulse * 0.6);
    coh = approach(coh, target, 2.2, dt);
    const acquire = reduced ? 1 : smooth(0, 1, (now - t0) / ACQUIRE_MS);

    // Message box timeline.
    const sinceSend = now - bridge.transmitAt;
    const waiting = bridge.transmitAt > bridge.feedbackAt && sinceSend < 8000;
    const transmitting = sinceSend >= 0 && sinceSend < TRANSMIT_MS;
    if (bridge.feedbackAt !== feedbackSeen && !transmitting) {
      feedbackSeen = bridge.feedbackAt;
      feedbackShownAt = now;
      if (bridge.feedback === "error") {
        bridge.insertStart = 0;
        bridge.insertEnd = el.input.value.length;
        bridge.insertAt = now;
      }
    }
    syncBox(now, transmitting);
    const send = transmitting || waiting ? clamp01(sinceSend / TRANSMIT_MS) : 0;
    const fbAge = now - feedbackShownAt;
    const fbA = boxGlyph ? smooth(0, 120, fbAge) * (1 - smooth(FEEDBACK_MS - 380, FEEDBACK_MS, fbAge)) : 0;

    const focused = document.activeElement === el.input;
    const ping = reduced ? 0 : Math.pow(Math.max(0, Math.sin(t * 1.4)), 12) * 0.5;
    quiet = approach(quiet, focused ? 1 : hover ? 0.6 : ping, 7, dt);
    const hasText = boxText.length > 0 && !waiting && !transmitting;
    const sendTarget = send > 0 || fbA > 0 ? 0 : hasText ? 1 : focused ? 0.45 : 0.3;
    sendA = approach(sendA, sendTarget, 10, dt);

    let caret = 0;
    if (send === 0 && fbA === 0) {
      if (focused) {
        const idle = now - lastInputAt;
        caret = idle < 520 || Math.floor(idle / 530) % 2 === 1 ? 1 : 0;
      } else if (!hasText) {
        caret = Math.floor(t / 0.6) % 3 === 2 ? 0 : 0.85;
      }
    }
    const k = scale;
    const dashLen = Math.min(12, Math.max(4, name.size * 0.038 * k));
    const cw = box.charW;
    const caretX = (box.padLeft + cw * (focused ? lastSel : boxText.length) - boxScroll) * k;
    const revX0 = (box.padLeft + cw * bridge.insertStart - boxScroll) * k;
    const revX1 = (box.padLeft + cw * bridge.insertEnd - boxScroll) * k;
    const reveal = smooth(0, REVEAL_MS, now - bridge.insertAt);
    const shakeAt = Math.max(bridge.rejectAt, bridge.feedback === "error" ? feedbackShownAt : -1e9);
    const shake = 1 - smooth(0, SHAKE_MS, now - shakeAt);

    // Acknowledgement: a sweep of full coherence runs through the name.
    const ackAge = bridge.feedback === "sent" ? (now - feedbackShownAt) / ACK_MS : 2;
    const ackOn = ackAge >= 0 && ackAge < 1;
    const ackX = nb.x - nb.w * 0.15 + nb.w * 1.3 * (reduced ? 0.5 : ackAge);
    const ackS = ackOn ? Math.sin(Math.PI * ackAge) * (reduced ? 0.5 : 1) : 0;

    gl.uniform2f(loc.uRes, bufW, bufH);
    gl.uniform1f(loc.uTime, t);
    gl.uniform4f(loc.uBoxRect, box.rect.x * k, box.rect.y * k, Math.round(box.rect.w * k), Math.round(box.rect.h * k));
    gl.uniform4f(loc.uLens, lensX * k, lensY * k, (Math.min(cssW, cssH) * 0.22 + 80) * k, 1);
    gl.uniform3f(
      loc.uField,
      coh * acquire,
      reduced ? 1.2 : 26,
      (reduced ? 0 : name.size * 0.045 * k) * (1 - pulse) + (1 - acquire) * name.size * 0.16 * k,
    );
    gl.uniform2f(loc.uDrift, drift1, drift2);
    const margin = name.size * 0.4;
    gl.uniform4f(loc.uNameBox, (nb.x - margin) * k, (nb.y - margin) * k, (nb.x + nb.w + margin) * k, (nb.y + nb.h + margin) * k);
    gl.uniform4f(loc.uAck, ackX * k, ackS, nb.w * 0.14 * k, dashLen);
    gl.uniform4f(loc.uBoxA, quiet, caretX, caret, send);
    gl.uniform1f(loc.uMotion, reduced ? 0 : 1);
    gl.uniform4f(loc.uBoxB, revX0, revX1, reveal, reduced ? 0 : shake);
    gl.uniform4f(loc.uBoxC, sendA, fbA, box.glyphTop * k, box.glyphBottom * k);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!live) {
      live = true;
      el.root.dataset.live = "1";
    }
  }

  // Events.
  const onMove = (e: PointerEvent) => {
    const now = performance.now();
    const gap = now - pLast;
    if (pActive && gap > 0 && gap < 100) {
      const vx = ((e.clientX - px) / gap) * 1000;
      pointerVx += (Math.max(-3000, Math.min(3000, vx)) - pointerVx) * 0.5;
    }
    px = e.clientX;
    py = e.clientY;
    pActive = true;
    pTouch = e.pointerType !== "mouse";
    pLast = now;
  };
  const onDown = (e: PointerEvent) => {
    pActive = false;
    onMove(e);
    if (!el.form.contains(e.target as Node)) tapAt = pLast;
  };
  const onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) pActive = false;
  };
  const onBlur = () => {
    pActive = false;
  };
  const onEnter = () => {
    hover = true;
  };
  const onLeave = () => {
    hover = false;
  };
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (ready && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const onMotion = () => {
    reduced = motionQuery.matches;
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    ready = false;
    live = false;
    program = null;
    delete el.root.dataset.live;
  };
  const onRestored = () => {
    boxSeen = -1;
    if (init()) void layout();
  };

  let layoutQueued = 0;
  const queueLayout = () => {
    cancelAnimationFrame(layoutQueued);
    layoutQueued = requestAnimationFrame(() => void layout());
  };
  const resizeObserver = new ResizeObserver(queueLayout);

  if (!init()) {
    canvas.remove();
    return () => {};
  }
  resizeObserver.observe(el.root);
  resizeObserver.observe(el.name);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("mouseout", onOut);
  window.addEventListener("blur", onBlur);
  el.form.addEventListener("pointerenter", onEnter);
  el.form.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  motionQuery.addEventListener("change", onMotion);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  document.fonts.addEventListener("loadingdone", queueLayout);
  void layout();

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(layoutQueued);
    resizeObserver.disconnect();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    document.removeEventListener("mouseout", onOut);
    window.removeEventListener("blur", onBlur);
    el.form.removeEventListener("pointerenter", onEnter);
    el.form.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
    motionQuery.removeEventListener("change", onMotion);
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    document.fonts.removeEventListener("loadingdone", queueLayout);
    delete el.root.dataset.live;
    if (!gl.isContextLost()) {
      gl.deleteTexture(nameTex);
      gl.deleteTexture(boxTex);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
  };
}
