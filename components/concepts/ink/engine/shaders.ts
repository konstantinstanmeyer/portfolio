export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
`;

/** Samples a glyph stamp placed at rect (xy origin, zw size, in uv); zero outside. */
const STAMP = `
float stampAt(sampler2D tex, vec4 rect, vec2 uv, vec2 gx, vec2 gy) {
  vec2 p = (uv - rect.xy) / rect.zw;
  vec2 inside = step(vec2(0.0), p) * step(p, vec2(1.0));
  return textureGrad(tex, p, gx / rect.zw, gy / rect.zw).x * inside.x * inside.y;
}
float stampLod(sampler2D tex, vec4 rect, vec2 uv, float lod) {
  vec2 p = (uv - rect.xy) / rect.zw;
  vec2 inside = step(vec2(0.0), p) * step(p, vec2(1.0));
  return textureLod(tex, p, lod).x * inside.x * inside.y;
}
`;

export const SPLAT = `${HEAD}
uniform sampler2D uBase;
uniform vec2 uPoint;
uniform float uAspect;
uniform float uRadius;
uniform vec4 uValue;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  o = texture(uBase, vUv) + uValue * exp(-dot(p, p) / uRadius);
}`;

export const CURL = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;
  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

/** Vorticity confinement plus a slow, divergence-free ambient current. */
export const FORCE = `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlStrength;
uniform float uDt;
uniform float uTime;
uniform float uIdle;
uniform float uAspect;
void main() {
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uCurlStrength * C * smoothstep(1.5, 8.0, abs(C));
  f.y = -f.y;

  vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.4;
  float t = uTime;
  float a1 = 1.3 * p.x + 0.23 * t, b1 = 1.9 * p.y - 0.17 * t;
  float a2 = 2.7 * p.x - 1.1 * p.y + 0.29 * t;
  float dpx = 1.3 * cos(a1) * sin(b1) + 1.62 * cos(a2);
  float dpy = 1.9 * sin(a1) * cos(b1) - 0.66 * cos(a2);
  vec2 idle = vec2(dpy, -dpx) * uIdle;

  vec2 v = texture(uVel, vUv).xy + (f + idle) * uDt;
  o = vec4(clamp(v, vec2(-900.0), vec2(900.0)), 0.0, 1.0);
}`;

/** Divergence, minus up to four point sources (ink drops push the surface outward). */
export const DIVERGENCE = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec4 uDrops[4];
void main() {
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
  float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
  vec2 C = texture(uVel, vUv).xy;
  if (vUv.x - uTexel.x < 0.0) L = -C.x;
  if (vUv.x + uTexel.x > 1.0) R = -C.x;
  if (vUv.y + uTexel.y > 1.0) T = -C.y;
  if (vUv.y - uTexel.y < 0.0) B = -C.y;
  float div = 0.5 * (R - L + T - B);
  for (int i = 0; i < 4; i++) {
    vec2 p = vUv - uDrops[i].xy;
    p.x *= uAspect;
    div -= uDrops[i].z * exp(-dot(p, p) / uDrops[i].w);
  }
  o = vec4(div, 0.0, 0.0, 1.0);
}`;

export const SCALE = `${HEAD}
uniform sampler2D uTex;
uniform float uValue;
void main() {
  o = uValue * texture(uTex, vUv);
}`;

export const JACOBI = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDiv;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float d = texture(uDiv, vUv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`;

export const GRADIENT = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}`;

export const ADVECT = `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uDt;
uniform float uKeep;
void main() {
  vec2 coord = vUv - uDt * texture(uVel, vUv).xy * uTexel;
  o = uKeep * texture(uSrc, coord);
}`;

/**
 * Reference map: xy = where the name's ink at this point came from, zw = the same
 * for a sent message. The name's map relaxes home once the water calms; the
 * message's never does, so it drifts away.
 */
export const MEMORY = `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uDisp;
uniform vec2 uTexel;
uniform float uDt;
uniform float uCalm;
uniform float uActive;
uniform float uMsgKeep;
void main() {
  vec2 vel = texture(uVel, vUv).xy;
  vec2 step = uDt * vel * uTexel;
  vec4 d = texture(uDisp, vUv - step);
  d.xy -= step;
  d.zw = (d.zw - step) * uMsgKeep;
  float k = mix(uCalm, uActive, smoothstep(1.5, 22.0, length(vel)));
  d.xy *= exp(-k * uDt);
  o = clamp(d, vec4(-0.6), vec4(0.6));
}`;

/** Loose ink: washes shed by moving letters, drops and leaks. Slowly soaks away. */
export const WASH = `${HEAD}
${STAMP}
uniform sampler2D uVel;
uniform sampler2D uWash;
uniform sampler2D uDisp;
uniform sampler2D uName;
uniform sampler2D uMsg;
uniform vec4 uNameRect;
uniform vec4 uMsgRect;
uniform float uNameLod;
uniform float uMsgLod;
uniform float uMsgAlpha;
uniform vec2 uTexel;
uniform float uDt;
uniform float uKeep;
uniform float uShed;
void main() {
  vec2 vel = texture(uVel, vUv).xy;
  float w = texture(uWash, vUv - uDt * vel * uTexel).x * uKeep;
  vec4 d = texture(uDisp, vUv);
  float ink = stampLod(uName, uNameRect, vUv + d.xy, uNameLod);
  float msg = stampLod(uMsg, uMsgRect, vUv + d.zw, uMsgLod) * uMsgAlpha;
  float stir = smoothstep(2.0, 30.0, length(vel));
  w += uDt * uShed * (stir * ink + (0.9 + 2.0 * stir) * msg);
  o = vec4(min(w, 2.0), 0.0, 0.0, 1.0);
}`;

/** One-off procedural sheet: r tone, gb fibre direction, a tooth. */
export const PAPER = `${HEAD}
uniform float uScale;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), e = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
void main() {
  vec2 p = gl_FragCoord.xy / uScale;
  float cloud = fbm(p * 0.006) * 0.6 + fbm(p * 0.03) * 0.4;
  float fib = 0.0;
  vec2 dir = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float a = float(i) * 2.39996 + 0.7;
    vec2 ax = vec2(cos(a), sin(a));
    vec2 q = vec2(dot(p, ax), dot(p, vec2(-ax.y, ax.x)));
    float n = noise(q * vec2(0.045, 0.55) + float(i) * 31.7);
    float ridge = pow(1.0 - abs(n * 2.0 - 1.0), 14.0);
    fib += ridge;
    dir += ridge * ax * (noise(q * 0.02 + float(i)) * 2.0 - 1.0);
  }
  float grain = hash(floor(p * 1.5)) - 0.5;
  float tooth = fbm(p * 0.4 + 3.0);
  float tone = 0.5 + (cloud - 0.5) * 0.9 + fib * 0.08 + grain * 0.12;
  o = vec4(tone, clamp(dir * 0.5 + 0.5, 0.0, 1.0), tooth);
}`;

export const DISPLAY = `${HEAD}
${STAMP}
uniform sampler2D uDisp;
uniform sampler2D uWash;
uniform sampler2D uPaper;
uniform sampler2D uName;
uniform sampler2D uMsg;
uniform vec4 uNameRect;
uniform vec4 uMsgRect;
uniform vec2 uNameSize;
uniform float uMsgAlpha;
uniform vec2 uPx;
uniform vec2 uDispTexel;
uniform float uBleed;
uniform vec3 uPaperCol;
uniform vec3 uInkCol;
void main() {
  vec4 d = texture(uDisp, vUv);
  vec4 pp = texture(uPaper, vUv);
  vec2 fib = (pp.yz * 2.0 - 1.0) * uPx * uBleed;
  float tooth = pp.w - 0.5;

  vec2 nuv = vUv + d.xy;
  vec2 gx = dFdx(nuv), gy = dFdy(nuv);
  float ink = stampAt(uName, uNameRect, nuv + fib, gx, gy);

  vec2 sx = gx / uNameRect.zw * uNameSize, sy = gy / uNameRect.zw * uNameSize;
  float lod = max(0.0, 0.5 * log2(max(dot(sx, sx), dot(sy, sy))));
  // where the film is folded finer than a pixel, let ink clump rather than grey out
  ink = mix(ink, smoothstep(0.18, 0.62, ink), clamp((lod - 1.0) / 3.0, 0.0, 1.0));
  float halo = stampLod(uName, uNameRect, nuv, lod + 2.2);
  float rim = ink * (1.0 - halo);

  vec2 muv = vUv + d.zw;
  vec2 mx = dFdx(muv), my = dFdy(muv);
  float msg = 0.0;
  if (uMsgAlpha > 0.0) msg = stampAt(uMsg, uMsgRect, muv + fib * 0.5, mx, my) * uMsgAlpha;

  // film thinning: where the surface has been stretched open, the ink thins out
  vec2 ex = vec2(uDispTexel.x, 0.0), ey = vec2(0.0, uDispTexel.y);
  vec2 ddx = (texture(uDisp, vUv + ex).xy - texture(uDisp, vUv - ex).xy) / (2.0 * uDispTexel.x);
  vec2 ddy = (texture(uDisp, vUv + ey).xy - texture(uDisp, vUv - ey).xy) / (2.0 * uDispTexel.y);
  float area = (1.0 + ddx.x) * (1.0 + ddy.y) - ddy.x * ddx.y;
  float film = smoothstep(0.0, 0.14, area);
  ink *= film;
  rim *= film;

  float wash = texture(uWash, vUv).x;

  // capillary bleed: a faint feathered stain wicking out along the fibres
  float stain = stampLod(uName, uNameRect, nuv + fib * 4.0, lod + 3.6) * film;
  stain *= 0.05 + 0.5 * pow(clamp(pp.x, 0.0, 1.0), 3.0);

  float pigment = ink * (2.7 + 1.1 * tooth) + rim * 0.9 + msg * 2.6
    + wash * (1.05 + 1.4 * tooth) + stain;
  float a = 1.0 - exp(-pigment);

  vec3 paper = uPaperCol * (0.962 + 0.075 * pp.x);
  vec2 c = vUv - 0.5;
  paper *= 1.0 - dot(c, c) * 0.09;
  vec3 inkCol = uInkCol * (0.9 + 0.3 * pp.x);
  vec3 col = mix(paper, inkCol, a);
  col += vec3(-0.012, -0.002, 0.014) * a * (1.0 - a) * 4.0;
  o = vec4(col, 1.0);
}`;
