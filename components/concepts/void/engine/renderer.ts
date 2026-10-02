import { ATLAS_H, ATLAS_W, BASE_FRAC, CELL, CELL_EM, COLS, STRIDE } from "./constants";
import { DECAY_FS, FULL_VS, GLYPH_FS, GLYPH_VS, POOL_FS, POOL_VS, TRAIL_FS } from "./shaders";

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  prog: WebGLProgram;
  u: Uniforms;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, names: string[]): Program {
  const prog = gl.createProgram();
  const attach = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error("shader");
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getShaderInfoLog(sh) ?? "compile");
    }
    gl.attachShader(prog, sh);
    gl.deleteShader(sh);
  };
  attach(gl.VERTEX_SHADER, vs);
  attach(gl.FRAGMENT_SHADER, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  }
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

export interface DrawList {
  glyphs: Float32Array;
  glyphCount: number;
  stamps: Float32Array;
  stampCount: number;
  trail: boolean;
  decay: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private glyph!: Program;
  private pool!: Program;
  private decay!: Program;
  private trail!: Program;
  private atlas!: WebGLTexture;
  private quad!: WebGLBuffer;
  private glyphBuf!: WebGLBuffer;
  private stampBuf!: WebGLBuffer;
  private glyphVao!: WebGLVertexArrayObject;
  private stampVao!: WebGLVertexArrayObject;
  private emptyVao!: WebGLVertexArrayObject;
  private glyphCap = 0;
  private stampCap = 0;
  private fbo: WebGLFramebuffer | null = null;
  private trailTex: WebGLTexture | null = null;
  private float = false;
  private trailW = 0;
  private trailH = 0;
  private cssW = 1;
  private cssH = 1;
  private pxW = 1;
  private pxH = 1;
  private mipDirty = false;
  private trailLive = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.init();
  }

  /** (Re)creates every GPU resource; also used after context restore. */
  init() {
    const gl = this.gl;
    this.float = !!gl.getExtension("EXT_color_buffer_float");
    this.glyph = compile(gl, GLYPH_VS, GLYPH_FS, ["u_view", "u_cell", "u_cellV", "u_mirror", "u_atlas"]);
    this.pool = compile(gl, POOL_VS, POOL_FS, ["u_view", "u_kind"]);
    this.decay = compile(gl, FULL_VS, DECAY_FS, ["u_value"]);
    this.trail = compile(gl, FULL_VS, TRAIL_FS, ["u_trail"]);

    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 5, gl.RGBA8, ATLAS_W, ATLAS_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.glyphBuf = gl.createBuffer();
    this.stampBuf = gl.createBuffer();
    this.glyphCap = 0;
    this.stampCap = 0;
    this.glyphVao = this.makeVao(this.glyphBuf);
    this.stampVao = this.makeVao(this.stampBuf);
    this.emptyVao = gl.createVertexArray();
    this.fbo = null;
    this.trailTex = null;
    this.trailW = 0;
    this.trailH = 0;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 1);
  }

  private makeVao(buf: WebGLBuffer) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bytes, 32);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  uploadCell(cell: number, px: Uint8Array) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, (cell % COLS) * CELL, Math.floor(cell / COLS) * CELL, CELL, CELL, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.mipDirty = true;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.pxW = Math.max(1, Math.round(cssW * dpr));
    this.pxH = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== this.pxW) this.canvas.width = this.pxW;
    if (this.canvas.height !== this.pxH) this.canvas.height = this.pxH;
    this.ensureTrail();
  }

  private ensureTrail() {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.cssW));
    const h = Math.max(1, Math.round(this.cssH));
    if (this.fbo && w === this.trailW && h === this.trailH) return;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.trailTex) gl.deleteTexture(this.trailTex);
    this.trailW = w;
    this.trailH = h;
    const make = (float: boolean) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!ok) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        return null;
      }
      return { tex, fbo };
    };
    let t = this.float ? make(true) : null;
    if (!t) {
      this.float = false;
      t = make(false);
    }
    this.trailTex = t?.tex ?? null;
    this.fbo = t?.fbo ?? null;
    if (this.fbo) {
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.trailLive = false;
  }

  private upload(buf: WebGLBuffer, data: Float32Array, count: number, stamp: boolean) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const need = count * STRIDE;
    const cap = stamp ? this.stampCap : this.glyphCap;
    if (need > cap) {
      const size = Math.max(need, data.length);
      gl.bufferData(gl.ARRAY_BUFFER, size * 4, gl.DYNAMIC_DRAW);
      if (stamp) this.stampCap = size;
      else this.glyphCap = size;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, need);
  }

  draw(d: DrawList) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    if (this.mipDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.mipDirty = false;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);

    const trailOn = d.trail && this.fbo !== null;
    if (trailOn && this.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.trailW, this.trailH);
      gl.bindVertexArray(this.emptyVao);
      gl.useProgram(this.decay.prog);
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      gl.uniform1f(this.decay.u.u_value, d.decay);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!this.float) {
        gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform1f(this.decay.u.u_value, 1.5 / 255);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.blendEquation(gl.FUNC_ADD);
      }
      gl.blendFunc(gl.ONE, gl.ONE);
      if (d.stampCount > 0) {
        this.upload(this.stampBuf, d.stamps, d.stampCount, true);
        gl.useProgram(this.pool.prog);
        gl.uniform2f(this.pool.u.u_view, this.cssW, this.cssH);
        gl.uniform1f(this.pool.u.u_kind, 2);
        gl.bindVertexArray(this.stampVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.stampCount);
      }
      this.trailLive = true;
    } else if (this.trailLive && this.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.trailLive = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.pxW, this.pxH);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (trailOn && this.trailTex) {
      gl.bindVertexArray(this.emptyVao);
      gl.useProgram(this.trail.prog);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
      gl.uniform1i(this.trail.u.u_trail, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (d.glyphCount === 0) return;
    this.upload(this.glyphBuf, d.glyphs, d.glyphCount, false);
    gl.bindVertexArray(this.glyphVao);

    gl.useProgram(this.pool.prog);
    gl.uniform2f(this.pool.u.u_view, this.cssW, this.cssH);
    if (d.glyphCount < 320) {
      gl.uniform1f(this.pool.u.u_kind, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.glyphCount);
    }
    gl.uniform1f(this.pool.u.u_kind, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.glyphCount);

    gl.useProgram(this.glyph.prog);
    this.glyphUniforms(1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.glyphCount);
    this.glyphUniforms(0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.glyphCount);
    gl.bindVertexArray(null);
  }

  private glyphUniforms(mirror: number) {
    const gl = this.gl;
    const u = this.glyph.u;
    gl.uniform2f(u.u_view, this.cssW, this.cssH);
    gl.uniform4f(u.u_cell, CELL_EM, BASE_FRAC, COLS, CELL / ATLAS_W);
    gl.uniform1f(u.u_cellV, CELL / ATLAS_H);
    gl.uniform1f(u.u_mirror, mirror);
    gl.uniform1i(u.u_atlas, 0);
  }

  dispose() {
    const gl = this.gl;
    if (!gl.isContextLost()) {
      gl.deleteProgram(this.glyph.prog);
      gl.deleteProgram(this.pool.prog);
      gl.deleteProgram(this.decay.prog);
      gl.deleteProgram(this.trail.prog);
      gl.deleteTexture(this.atlas);
      gl.deleteBuffer(this.quad);
      gl.deleteBuffer(this.glyphBuf);
      gl.deleteBuffer(this.stampBuf);
      gl.deleteVertexArray(this.glyphVao);
      gl.deleteVertexArray(this.stampVao);
      gl.deleteVertexArray(this.emptyVao);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.trailTex) gl.deleteTexture(this.trailTex);
    }
  }
}
