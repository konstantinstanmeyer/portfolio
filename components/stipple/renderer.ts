// Draws the dots: WebGL point sprites (soft round dots), with a Canvas 2D
// fallback when WebGL is unavailable. Colours come from the active palette.

import { PALETTE, rgb, type Palette } from "./palette";

export interface DotRenderer {
  kind: "webgl" | "2d";
  resize(width: number, height: number, dpr: number): void;
  setAttributes(attrs: Float32Array, count: number): void;
  /** Per-dot [size, opacity] while title `index` (0–2) stands in for the name. */
  setTitle(index: number, attrs: Float32Array, count: number): void;
  /** How far each title has faded in (0–1, summing to at most 1). */
  setMorph(weights: ArrayLike<number>): void;
  /** Draws `count` dots; with `pos` null, redraws the last positions. */
  draw(pos: Float32Array | null, count: number): void;
  dispose(): void;
}

const VERTEX = `
attribute vec2 a_pos;
attribute vec2 a_attr;
attribute vec2 a_title0;
attribute vec2 a_title1;
attribute vec2 a_title2;
uniform vec3 u_morph;
uniform vec2 u_size;
uniform float u_dpr;
uniform float u_scale;
varying float v_alpha;
varying float v_px;
void main() {
  vec2 clip = a_pos / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  // Crossfade each dot's look between the name and whichever titles are showing.
  float base = max(0.0, 1.0 - u_morph.x - u_morph.y - u_morph.z);
  vec2 attr = a_attr * base + a_title0 * u_morph.x + a_title1 * u_morph.y + a_title2 * u_morph.z;
  v_px = attr.x * u_scale * u_dpr;
  gl_PointSize = v_px + 1.0;
  v_alpha = attr.y;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_ink;
uniform float u_alpha;
varying float v_alpha;
varying float v_px;
void main() {
  float r = length(gl_PointCoord - 0.5) * (v_px + 1.0);
  float coverage = clamp(v_px * 0.5 - r + 0.5, 0.0, 1.0);
  float a = coverage * v_alpha * u_alpha;
  gl_FragColor = vec4(u_ink * a, a);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
}

function createWebGLRenderer(canvas: HTMLCanvasElement, palette: Palette): DotRenderer | null {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const aPos = gl.getAttribLocation(program, "a_pos");
  const aAttr = gl.getAttribLocation(program, "a_attr");
  const uSize = gl.getUniformLocation(program, "u_size");
  const uDpr = gl.getUniformLocation(program, "u_dpr");
  const uMorph = gl.getUniformLocation(program, "u_morph");
  const aTitles = [0, 1, 2].map((k) => gl.getAttribLocation(program, `a_title${k}`));
  const titleBuffers = aTitles.map(() => gl.createBuffer());
  // Until a title is built its weight stays 0, so a constant stands in.
  for (const loc of aTitles) {
    gl.disableVertexAttribArray(loc);
    gl.vertexAttrib2f(loc, 0, 0);
  }
  gl.uniform3f(uMorph, 0, 0, 0);
  const [paperR, paperG, paperB] = rgb(palette.paper);
  const [inkR, inkG, inkB] = rgb(palette.ink);
  gl.uniform3f(gl.getUniformLocation(program, "u_ink"), inkR, inkG, inkB);
  gl.uniform1f(gl.getUniformLocation(program, "u_alpha"), palette.alpha);
  gl.uniform1f(gl.getUniformLocation(program, "u_scale"), palette.size);

  const posBuffer = gl.createBuffer();
  const attrBuffer = gl.createBuffer();
  let capacity = 0;

  gl.enable(gl.BLEND);
  // Premultiplied colour. Light-on-dark dots screen together, so crowds glow
  // brighter but saturate softly instead of clipping to flat white.
  gl.blendFunc(gl.ONE, palette.additive ? gl.ONE_MINUS_SRC_COLOR : gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(paperR, paperG, paperB, 1);

  return {
    kind: "webgl",
    resize(width, height, dpr) {
      gl.viewport(0, 0, Math.round(width * dpr), Math.round(height * dpr));
      gl.uniform2f(uSize, width, height);
      gl.uniform1f(uDpr, dpr);
      // Resizing wipes the opaque canvas to black; paint paper straight away.
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    setAttributes(attrs, count) {
      // New dots: titles built for the old ones no longer apply.
      for (const loc of aTitles) {
        gl.disableVertexAttribArray(loc);
        gl.vertexAttrib2f(loc, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, attrs.subarray(0, count * 2), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aAttr);
      gl.vertexAttribPointer(aAttr, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      capacity = count;
      gl.bufferData(gl.ARRAY_BUFFER, capacity * 8, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    },
    setTitle(index, attrs, count) {
      const loc = aTitles[index];
      if (loc === undefined || loc < 0 || count !== capacity) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, titleBuffers[index]);
      gl.bufferData(gl.ARRAY_BUFFER, attrs.subarray(0, count * 2), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    },
    setMorph(weights) {
      gl.uniform3f(uMorph, weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0);
    },
    draw(pos, count) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      const n = Math.min(count, capacity);
      if (n === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      if (pos) gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos.subarray(0, n * 2));
      gl.drawArrays(gl.POINTS, 0, n);
    },
    dispose() {
      gl.deleteBuffer(posBuffer);
      gl.deleteBuffer(attrBuffer);
      for (const buffer of titleBuffers) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

function createCanvasRenderer(canvas: HTMLCanvasElement, palette: Palette): DotRenderer | null {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  let attrs: Float32Array = new Float32Array(0);
  // Positions arrive in buffers that go back to the simulation, so keep a copy.
  let last: Float32Array = new Float32Array(0);
  const titles: (Float32Array | null)[] = [null, null, null];
  const morph = [0, 0, 0];
  let width = 0;
  let height = 0;
  const clear = () => {
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, width, height);
  };
  return {
    kind: "2d",
    resize(w, h, dpr) {
      width = w;
      height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      clear();
    },
    setAttributes(next) {
      attrs = next;
      titles.fill(null);
    },
    setTitle(index, next) {
      titles[index] = next;
    },
    setMorph(weights) {
      for (let k = 0; k < 3; k++) morph[k] = weights[k] ?? 0;
    },
    draw(next, count) {
      if (next) {
        if (last.length < count * 2) last = new Float32Array(count * 2);
        last.set(next.subarray(0, count * 2));
      }
      const pos = last;
      clear();
      // No per-dot opacity here: once a title mostly shows, skip its spare dots.
      let shown = -1;
      for (let k = 0; k < 3; k++) if (morph[k] > 0.5) shown = k;
      const title = shown >= 0 ? titles[shown] : null;
      // One path and one fill for every dot; per-dot opacity is dropped here.
      ctx.fillStyle = palette.ink;
      ctx.globalAlpha = 0.85 * palette.alpha;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        if (title && title[i * 2 + 1] === 0) continue;
        // The size trim compensates for additive blending, which this path lacks.
        const s = attrs[i * 2] * (palette.additive ? 1 : palette.size);
        ctx.rect(pos[i * 2] - s / 2, pos[i * 2 + 1] - s / 2, s, s);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    dispose() {},
  };
}

/**
 * Compile the shaders on a throwaway canvas first: once the real canvas has a
 * WebGL context it can never fall back to 2D.
 */
function webglWorks(): boolean {
  const gl = document.createElement("canvas").getContext("webgl");
  if (!gl) return false;
  try {
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  } catch {
    return false;
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

export function createDotRenderer(canvas: HTMLCanvasElement, palette: Palette = PALETTE): DotRenderer | null {
  if (webglWorks()) {
    try {
      const renderer = createWebGLRenderer(canvas, palette);
      if (renderer) return renderer;
    } catch {
      // Fall through; the probe passed, so this is unexpected.
    }
  }
  return createCanvasRenderer(canvas, palette);
}
