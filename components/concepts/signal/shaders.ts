export const VERTEX = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// One grain = one buffer pixel. Everything is noise; only its statistics change.
export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uName;   // r: first line, g: second line
uniform sampler2D uBox;    // r: typed text, g: send glyph, b: feedback glyph
uniform vec4 uBoxRect;     // x, y, w, h
uniform vec4 uLens;        // x, y, radius, weight
uniform vec3 uField;       // coherence, boil hz, slip grains
uniform vec2 uDrift;       // carrier offset per line
uniform vec4 uNameBox;     // x0, y0, x1, y1 (with slip margin)
uniform vec4 uAck;         // sweep x, strength, width, dash length
uniform vec4 uBoxA;        // quiet, caret x, caret alpha, send progress
uniform vec4 uBoxB;        // reveal x0, reveal x1, reveal, shake
uniform vec4 uBoxC;        // send glyph alpha, feedback alpha, glyph top, glyph bottom
uniform float uMotion;     // 0 when reduced motion is requested

out vec4 outColor;

uvec3 pcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
const float INV = 1.0 / 4294967296.0;
float h1(ivec3 p) { return float(pcg(uvec3(p)).x) * INV; }
vec3 h3(ivec3 p) { return vec3(pcg(uvec3(p))) * INV; }

float tone(float n) { return n * n * n * 0.62; }
float dash(float n) { return n * n * 0.66; }

// Horizontal dashes of jittered length along one grain row.
float carrier(float x, int row, float len) {
  x += h1(ivec3(row, 3, 11)) * 173.0;
  float fx = x / len;
  float k = floor(fx);
  float seg = fx - k < h1(ivec3(int(k), row, 13)) * 0.85 ? k - 1.0 : k;
  return h1(ivec3(int(seg), row, 17));
}

float vnoise(vec2 q) {
  vec2 i = floor(q);
  vec2 f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = h1(ivec3(c, 5));
  float b = h1(ivec3(c + ivec2(1, 0), 5));
  float d = h1(ivec3(c + ivec2(0, 1), 5));
  float e = h1(ivec3(c + ivec2(1, 1), 5));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

float boxGlyph(ivec2 q, int ch) {
  if (q.x < 0 || q.y < 0 || q.x >= int(uBoxRect.z) || q.y >= int(uBoxRect.w)) return 0.0;
  return texelFetch(uBox, q, 0)[ch];
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  ivec2 c = ivec2(p);
  float t = uTime;

  // Background: every grain re-rolls on its own clock.
  float phase = h1(ivec3(c, 7));
  int frame = int(floor(t * uField.y + phase));
  vec3 r = h3(ivec3(c, frame));
  float v = tone(r.x);

  // Tuning: coherence rises near the lens.
  vec2 dl = p - uLens.xy;
  float lens = uLens.w * exp(-dot(dl, dl) / (uLens.z * uLens.z));
  float coh = mix(uField.x, 1.0, lens);

  float ackD = (p.x - uAck.x) / uAck.z;
  float ack = uAck.y * exp(-ackD * ackD);
  coh = min(1.0, coh + ack);

  if (p.x > uNameBox.x && p.y > uNameBox.y && p.x < uNameBox.z && p.y < uNameBox.w) {
    // Detuned rows slip sideways, like a receiver losing horizontal hold.
    float slip = (1.0 - coh) * uField.z * (vnoise(vec2(p.y * 0.07, t * 1.7)) * 2.0 - 1.0);
    ivec2 mc = clamp(ivec2(p + vec2(slip, 0.0)), ivec2(0), ivec2(uRes) - 1);
    vec2 m = texelFetch(uName, mc, 0).rg;
    float mask = max(m.r, m.g);
    if (mask > 0.0 && r.y < mask * coh) {
      float off = m.r >= m.g ? uDrift.x : uDrift.y;
      v = dash(carrier(p.x - off, c.y, uAck.w)) * (1.0 + ack * 0.5);
    }
  }

  // Message box: a small patch of the field that locks into signal on focus.
  vec2 bp = p - uBoxRect.xy;
  ivec2 bq = ivec2(floor(bp));
  bool rowIn = bp.y >= 0.0 && bp.y < uBoxRect.w;
  if (rowIn && bp.x >= 0.0 && bp.x < uBoxRect.z) {
    float q = uBoxA.x;
    if (r.y < mix(0.5, 1.0, q)) v = dash(carrier(p.x - t * 5.0, c.y, 13.0)) * mix(1.1, 0.4, q);
    else v *= mix(0.9, 0.45, q);

    // underline
    if (bp.y >= uBoxRect.w - 2.0 && r.z < mix(0.6, 1.0, q)) {
      v = 0.2 + 0.8 * dash(carrier(p.x - t * 9.0, c.y, 9.0));
    }

    int stable = int(floor(t * 6.0 + phase));
    vec3 g3 = h3(ivec3(c, stable + 577));
    float glyphV = 0.55 + 0.45 * carrier(p.x - t * 3.0, c.y, 4.0);

    // caret
    if (bp.x >= uBoxA.y && bp.x < uBoxA.y + 2.0 && bp.y >= uBoxC.z && bp.y < uBoxC.w) {
      if (g3.x < uBoxA.z * 0.92) v = glyphV;
    }

    if (uBoxA.w <= 0.0) {
      ivec2 gq = bq;
      if (uBoxB.w > 0.0) gq.x += int(uBoxB.w * 5.0 * sin(t * 90.0 + float(c.y) * 1.7));
      float reveal = (bp.x >= uBoxB.x && bp.x < uBoxB.y) ? uBoxB.z : 1.0;
      float txt = boxGlyph(gq, 0) * reveal;
      if (g3.y < txt * 0.93) v = glyphV;
    }

    float sendG = boxGlyph(bq, 1) * uBoxC.x;
    float fbG = boxGlyph(bq, 2) * uBoxC.y;
    if (g3.z < max(sendG, fbG) * 0.93) v = glyphV;
  }

  // Transmission: slices of the message accelerate down the line and dissolve.
  if (rowIn && uBoxA.w > 0.0 && bp.x >= 0.0) {
    float sp = uBoxA.w;
    float rr = h1(ivec3(c.y / 2, 0, 61));
    float travel = uMotion * pow(sp, 2.2) * (uRes.x - uBoxRect.x + 200.0) * (0.35 + 0.65 * rr);
    float tail = uMotion * 90.0 * sp * rr;
    int sx = int(floor(bp.x - travel));
    float g = max(boxGlyph(ivec2(sx, bq.y), 0), boxGlyph(ivec2(sx + int(tail * 0.5), bq.y), 0));
    g = max(g, boxGlyph(ivec2(sx + int(tail), bq.y), 0) * 0.7);
    float keep = g * (1.0 - smoothstep(0.4, 1.0, sp));
    if (r.z < keep) v = 0.5 + 0.5 * r.x;
  }

  v *= mix(1.0, 0.5, smoothstep(0.3, 0.78, length(p / uRes - 0.5)));
  outColor = vec4(vec3(v), 1.0);
}
`;
