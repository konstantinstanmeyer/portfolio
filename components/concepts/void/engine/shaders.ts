// Heat → incandescent colour: black, deep red, orange, amber, warm white.
const RAMP = /* glsl */ `
vec3 ramp(float t) {
  t = max(t, 0.0);
  float r = clamp(t * 2.3, 0.0, 1.0);
  float g = pow(clamp((t - 0.22) * 1.55, 0.0, 1.0), 1.15);
  float b = pow(clamp((t - 0.5) * 2.2, 0.0, 1.0), 1.2);
  return vec3(r, g, b) * (1.0 + max(t - 1.0, 0.0) * 1.2);
}
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5;
}
`;

const INSTANCE = /* glsl */ `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_a; // x, y, size, rot
layout(location = 2) in vec4 a_b; // heat, alpha, cell, refl
layout(location = 3) in float a_floor;
uniform vec2 u_view;
vec4 toClip(vec2 p) {
  vec2 c = p / u_view * 2.0 - 1.0;
  return vec4(c.x, -c.y, 0.0, 1.0);
}
`;

export const GLYPH_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE}
uniform vec4 u_cell; // cellEm, baseFrac, cols, cellU
uniform float u_cellV;
uniform float u_mirror;
out vec2 v_uv;
out float v_heat;
out float v_alpha;
out float v_depth;
out float v_refl;
void main() {
  float size = a_a.z;
  float C = u_cell.x * size;
  vec2 local = vec2((a_corner.x - 0.5) * C, (a_corner.y - u_cell.y) * C);
  float c = cos(a_a.w);
  float s = sin(a_a.w);
  vec2 p = a_a.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  v_depth = 0.0;
  if (u_mirror > 0.5) {
    p.y = 2.0 * a_floor - p.y;
    v_depth = (p.y - a_floor) / size;
  }
  float cell = a_b.z;
  vec2 cxy = vec2(mod(cell, u_cell.z), floor(cell / u_cell.z));
  v_uv = vec2((cxy.x + a_corner.x) * u_cell.w, (cxy.y + a_corner.y) * u_cellV);
  v_heat = a_b.x;
  v_alpha = a_b.y;
  v_refl = a_b.w;
  gl_Position = (u_mirror > 0.5 && a_b.w < 0.01) ? vec4(2.0, 2.0, 2.0, 1.0) : toClip(p);
}
`;

export const GLYPH_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform float u_mirror;
in vec2 v_uv;
in float v_heat;
in float v_alpha;
in float v_depth;
in float v_refl;
out vec4 o;
${RAMP}
void main() {
  vec4 t = texture(u_atlas, v_uv);
  float h = v_heat;
  // Hotter filaments swell a little: shift the distance threshold.
  float edge = 0.5 - 0.05 * clamp(h - 0.85, -0.6, 0.5);
  float w = max(fwidth(t.r) * 0.75, 0.002);
  float core = smoothstep(edge - w, edge + w, t.r);
  vec3 col;
  if (u_mirror > 0.5) {
    float fade = exp(-max(v_depth, 0.0) * 2.6) * smoothstep(-0.02, 0.06, v_depth) * v_refl;
    col = (ramp(h * 0.9) * core * 0.1 + ramp(h * 0.7) * t.a * 0.2 + ramp(h * 0.5) * t.b * 0.12) * fade;
  } else {
    col = ramp(h) * core + ramp(h * 0.8) * t.g * 0.4 + ramp(h * 0.62) * t.b * 0.22;
  }
  o = vec4(col * v_alpha, 1.0);
}
`;

// Soft light the letters throw into the air and onto the floor.
export const POOL_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE}
uniform float u_kind;
out vec2 v_l;
out float v_heat;
out float v_k;
void main() {
  float size = a_a.z;
  vec2 center;
  vec2 rad;
  float k;
  if (u_kind < 0.5) {
    center = vec2(a_a.x, a_a.y - 0.36 * size);
    rad = vec2(1.7, 1.35) * size;
    k = a_b.y * 0.04;
  } else if (u_kind < 1.5) {
    center = vec2(a_a.x, a_floor + 0.02 * size);
    rad = vec2(1.5, 0.26) * size;
    k = a_b.y * a_b.w * 0.075;
  } else {
    // Long-exposure thread: a tiny point of light, stamped along the path.
    center = a_a.xy;
    rad = vec2(size * 3.0);
    k = a_b.y;
  }
  v_l = a_corner * 2.0 - 1.0;
  v_heat = a_b.x;
  v_k = k;
  // Nothing to light: collapse the quad so it costs no fill.
  gl_Position = k < 1e-4 ? vec4(2.0, 2.0, 2.0, 1.0) : toClip(center + v_l * rad);
}
`;

export const POOL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float u_kind;
in vec2 v_l;
in float v_heat;
in float v_k;
out vec4 o;
${RAMP}
void main() {
  float r2 = dot(v_l, v_l);
  if (u_kind > 1.5) {
    float q = r2 * 9.0;
    float e = (exp(-q) + 0.1 * exp(-q / 7.0)) * max(1.0 - r2, 0.0);
    o = vec4(e * v_k * v_heat, 0.0, 0.0, 1.0);
    return;
  }
  float win = max(1.0 - r2, 0.0);
  float f = exp(-r2 * 3.2) * win * win;
  vec3 col = ramp(v_heat * 0.66) * f * v_k;
  col += ign(gl_FragCoord.xy) / 255.0 * step(0.0015, col.r);
  o = vec4(max(col, 0.0), 1.0);
}
`;

export const FULL_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const DECAY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float u_value;
out vec4 o;
void main() { o = vec4(u_value); }
`;

// Long-exposure trails: stored as energy, coloured on the way out so they
// cool from white through amber to red as they fade.
export const TRAIL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_trail;
in vec2 v_uv;
out vec4 o;
${RAMP}
void main() {
  float e = texture(u_trail, v_uv).r;
  vec3 col = ramp(e * 0.95) * clamp(e * 1.6, 0.0, 1.0);
  col += ign(gl_FragCoord.xy) / 255.0 * step(0.004, col.r);
  o = vec4(max(col, 0.0), 1.0);
}
`;
