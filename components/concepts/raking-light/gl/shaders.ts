export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Pass 1: tileable paper micro-relief (R) and formation/albedo (G), 1024² texels. */
export const PAPER_HEIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
const float S = 1024.0;

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}
vec2 grad(vec2 cell, vec2 per, uint seed) {
  uvec2 h = pcg2d(uvec2(mod(cell, per)) + uvec2(seed * 7919u, seed * 104729u));
  float a = float(h.x) * (6.28318530718 / 4294967295.0);
  return vec2(cos(a), sin(a));
}
float gnoise(vec2 p, vec2 per, uint seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad(i, per, seed), f);
  float b = dot(grad(i + vec2(1, 0), per, seed), f - vec2(1, 0));
  float c = dot(grad(i + vec2(0, 1), per, seed), f - vec2(0, 1));
  float d = dot(grad(i + vec2(1, 1), per, seed), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ridge(float n) { float r = 1.0 - min(abs(n) * 3.2, 1.0); return r * r * r; }

float pits(vec2 x) {
  vec2 cell = floor(x / 16.0);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(i, j);
    uvec2 h = pcg2d(uvec2(mod(c, vec2(S / 16.0))) + 911u);
    if ((h.x & 7u) > 1u) continue;
    vec2 pos = (c + vec2(h & 1023u) / 1023.0) * 16.0;
    float r = 0.7 + float((h.y >> 12u) & 255u) / 255.0 * 1.1;
    vec2 d = x - pos;
    d -= S * round(d / S);
    acc = max(acc, 1.0 - smoothstep(0.0, r, length(d)));
  }
  return acc;
}

void main() {
  vec2 x = gl_FragCoord.xy - 0.5;
  float grain = gnoise(x / 2.0, vec2(S / 2.0), 1u) * 0.45
              + gnoise(x / 4.0, vec2(S / 4.0), 2u) * 0.35
              + gnoise(x / 8.0, vec2(S / 8.0), 3u) * 0.2;
  vec2 w = vec2(gnoise(x / 64.0, vec2(16.0), 4u), gnoise(x / 64.0, vec2(16.0), 5u));
  vec2 q = x + w * 18.0;
  float clump = smoothstep(-0.3, 0.45, gnoise(x / 32.0, vec2(32.0), 6u));
  float fib = ridge(gnoise(q / vec2(16.0, 2.0), vec2(64.0, 512.0), 7u))
            + ridge(gnoise(q / vec2(2.0, 16.0), vec2(512.0, 64.0), 8u)) * 0.7
            + ridge(gnoise((q + 37.0) / vec2(32.0, 2.0), vec2(32.0, 512.0), 9u)) * clump;
  float h = 0.5 + grain * 0.32 + (fib - 0.45) * 0.14 - pits(x) * 0.22;
  float form = 0.5 + gnoise(x / 128.0, vec2(8.0), 10u) * 0.55 + gnoise(x / 32.0, vec2(32.0), 11u) * 0.25;
  o = vec4(clamp(h, 0.0, 1.0), clamp(form, 0.0, 1.0), 0.0, 1.0);
}`;

/** Pass 2: slopes of the micro-relief (RG), formation (B), height (A). */
export const PAPER_SLOPE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = ivec2(1023);
  float l = texelFetch(uSrc, (p + ivec2(-1, 0)) & m, 0).r;
  float r = texelFetch(uSrc, (p + ivec2(1, 0)) & m, 0).r;
  float d = texelFetch(uSrc, (p + ivec2(0, -1)) & m, 0).r;
  float u = texelFetch(uSrc, (p + ivec2(0, 1)) & m, 0).r;
  vec4 c = texelFetch(uSrc, p, 0);
  // Texture rows follow the page's y axis (down) when sampled, so row+1 is "below".
  vec2 s = vec2(r - l, u - d) * 0.5;
  o = vec4(clamp(0.5 + s * 2.5, 0.0, 1.0), c.g, c.r);
}`;

/** Lights the relief. Page space: css px, y down, z toward the viewer. */
export const SURFACE_FS = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uScale;
uniform float uEps;

uniform sampler2D uName;
uniform vec4 uNameBox;
uniform vec4 uNameProf;   // depth (signed), bevel, rim, spread

uniform sampler2D uType;
uniform vec4 uSlot;       // x, y, w, h
uniform float uTypeDepth;
uniform vec4 uLine;       // x0, x1, y (slot space), depth
uniform vec4 uCaret;      // x (slot space), depth, half height, -
uniform vec2 uRoller;     // x (slot space), amplitude

uniform sampler2D uPaper;
uniform vec3 uGrain;      // scale, micro slope, formation

uniform vec3 uLight;
uniform vec3 uLightCol;
uniform float uLightReach;
uniform float uLightSize;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform vec3 uAlbedo;
uniform float uExposure;
uniform float uMaxH;
uniform float uReach;   // how far the name's shadows can fall outside its box

out vec4 o;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float soft(float x) { return x * x * (3.0 - 2.0 * x); }

float press(float d, float bevel) {
  float t = sat(0.5 - d / bevel);
  return t * t * (3.0 - 2.0 * t);
}

float boxSdf(vec2 p, vec2 c, vec2 b, float r) {
  vec2 q = abs(p - c) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float nameDist(vec2 p) {
  vec2 uv = (p - uNameBox.xy) / uNameBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return uNameProf.w;
  return texture(uName, uv).r;
}

// Macro relief height in css px. "pressed" is how compressed the paper is there (0..1).
float relief(vec2 p, out float pressed) {
  float d = nameDist(p);
  float e = press(d, uNameProf.y);
  float k = (d - uNameProf.y * 0.85) / (uNameProf.y * 0.75);
  float h = uNameProf.x * e + uNameProf.z * exp(-k * k);
  pressed = e;
  vec2 q = p - uSlot.xy;
  if (q.x > -3.0 && q.y > -3.0 && q.x < uSlot.z + 3.0 && q.y < uSlot.w + 3.0) {
    // A scored hairline with tapered ends, the words pressed just above it.
    float dl = boxSdf(q, vec2((uLine.x + uLine.y) * 0.5, uLine.z), vec2((uLine.y - uLine.x) * 0.5, 0.4), 0.4);
    float taper = smoothstep(uLine.x, uLine.x + 18.0, q.x) * smoothstep(uLine.y, uLine.y - 18.0, q.x);
    float line = press(dl, 1.1) * mix(0.35, 1.0, taper);
    float m = texture(uType, q / uSlot.zw).r;
    float dc = boxSdf(q, vec2(uCaret.x, uSlot.w * 0.5 - 1.0), vec2(0.55, uCaret.z), 0.55);
    float c = press(dc, 1.0) * uCaret.y;
    float t = max(m, c);
    float rx = (q.x - uRoller.x) / 6.0;
    float band = smoothstep(uSlot.w * 0.5 + 12.0, uSlot.w * 0.5 + 6.0, abs(q.y - uSlot.w * 0.5 + 1.0) + 6.0);
    h += uRoller.y * exp(-rx * rx) * band - uLine.w * line - uTypeDepth * t;
    pressed = max(pressed, max(t, line * 0.6));
  }
  return h;
}

float reliefOnly(vec2 p) { float x; return relief(p, x); }

float shadow(vec3 P, vec3 toL, float dist) {
  float dxy = max(length(toL.xy), 0.5);
  vec2 dir = toL.xy / dxy;
  float slope = toL.z / dxy;
  float k = dist / uLightSize;
  float horizon = sat(0.5 + 0.5 * k * slope);
  float tMax = min(min(dxy, 96.0), (uMaxH - P.z) / max(slope, 1e-3));
  if (tMax <= 0.6) return soft(horizon);
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float res = 1.0;
  for (int i = 0; i < 24; i++) {
    float f = (float(i) + j) / 24.0;
    float t = 0.6 + (tMax - 0.6) * f * f;
    vec2 q = P.xy + dir * t;
    float clear = P.z + slope * t + 0.06 - reliefOnly(q);
    res = min(res, sat(0.5 + 0.5 * k * clear / t));
  }
  return soft(min(res, horizon));
}

bool nearRelief(vec2 p) {
  vec2 a = uNameBox.xy - uReach, b = uNameBox.xy + uNameBox.zw + uReach;
  vec2 c = uSlot.xy - 3.0, d = uSlot.xy + uSlot.zw + 3.0;
  return (all(greaterThan(p, a)) && all(lessThan(p, b))) || (all(greaterThan(p, c)) && all(lessThan(p, d)));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float pressed;
  float h = relief(p, pressed);
  vec2 g = vec2(0.0);
  bool near = nearRelief(p);
  if (near) {
    float e = uEps;
    g = vec2(reliefOnly(p + vec2(e, 0.0)) - reliefOnly(p - vec2(e, 0.0)),
             reliefOnly(p + vec2(0.0, e)) - reliefOnly(p - vec2(0.0, e))) / (2.0 * e);
  }

  mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  vec4 m1 = texture(uPaper, p * uGrain.x);
  vec4 m2 = texture(uPaper, R * p * (uGrain.x * 0.731) + 0.37);
  vec2 ms = (m1.rg - 0.5) + transpose(R) * (m2.rg - 0.5) * 0.75;
  ms *= uGrain.y * (1.0 - 0.6 * pressed);
  float alb = 1.0 + ((m1.b - 0.5) + (m2.b - 0.5) * 0.6) * uGrain.z;

  vec3 N = normalize(vec3(-(g + ms), 1.0));
  vec3 P = vec3(p, h);
  vec3 toL = uLight - P;
  float d2 = dot(toL, toL);
  float dist = sqrt(d2);
  vec3 L = toL / dist;
  float nl = dot(N, L);

  vec3 col = vec3(0.0);
  if (nl > 0.0) {
    // Large lamp near the horizon dims flat paper smoothly; relief adds occlusion on top.
    float horizon = soft(sat(0.5 + 0.5 * (dist / uLightSize) * (uLight.z / max(length(toL.xy), 0.5))));
    float sh = near ? shadow(P, toL, dist) : horizon;
    // Paper scatters: a shadowed floor still gets some light bounced off the lit wall.
    sh = max(sh, 0.22 * horizon);
    float att = 1.0 / (1.0 + d2 / (uLightReach * uLightReach));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float nh = sat(dot(N, H));
    float r = mix(0.58, 0.27, pressed);
    float a2 = r * r * r * r;
    float den = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159 * den * den);
    float F = 0.04 + 0.96 * pow(1.0 - sat(H.z), 5.0);
    float spec = D * F * 0.6 / max(N.z, 0.2);
    col = (uAlbedo * alb * nl + spec) * uLightCol * att * sh;
  }
  float nf = sat(dot(N, uFillDir));
  col += uAlbedo * alb * nf * uFillCol;

  col = 1.0 - exp(-col * uExposure);
  // Toe: keep the paper's darks deep while rims stay bright.
  col = col * col / (col + 0.012);
  vec2 v = (gl_FragCoord.xy / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, 0.6, smoothstep(0.35, 1.2, length(v)));
  col = pow(col, vec3(1.0 / 2.2));
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + 17.0, vec2(0.06711056, 0.00583715))));
  o = vec4(col + (n - 0.5) / 255.0, 1.0);
}`;
