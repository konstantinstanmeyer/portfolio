import * as THREE from "three";

export interface GroundPoolOptions {
  /** Peak brightness at the centre, in linear units (a whisper: ~0.005–0.01). */
  intensity?: number;
  /** Gaussian falloff radius in metres. */
  sigma?: number;
  /** Radius where the pool starts its final fade to pure black. */
  fadeStart?: number;
  /** Radius beyond which the ground is exactly #000. */
  fadeEnd?: number;
  /** How much the cast shadow darkens the pool, 0–1. */
  shadowStrength?: number;
  /** Light colour of the pool. */
  tint?: THREE.ColorRepresentation;
}

/**
 * A faint pool of light on the ground, darkened by the scene's shadow map.
 *
 * It ignores scene lights: brightness is an analytic radial falloff that
 * reaches exactly zero at `fadeEnd`, so the plane has no visible edge against
 * the black background. Triangular dither (only where the pool is non-zero)
 * keeps the 8-bit gradient free of banding.
 */
export function createGroundPool({
  intensity = 0.0085,
  sigma = 0.9,
  fadeStart = 0.8,
  fadeEnd = 2,
  shadowStrength = 0.85,
  tint = 0xffffff,
}: GroundPoolOptions = {}) {
  const geometry = new THREE.PlaneGeometry(fadeEnd * 2.2, fadeEnd * 2.2);
  geometry.rotateX(-Math.PI / 2);

  // ShadowMaterial already wires up shadow-map sampling; we only swap its output.
  const material = new THREE.ShadowMaterial();
  material.transparent = false;
  material.toneMapped = false;

  const uniforms = {
    uIntensity: { value: intensity },
    uSigma: { value: sigma },
    uFadeStart: { value: fadeStart },
    uFadeEnd: { value: fadeEnd },
    uShadow: { value: shadowStrength },
    uTint: { value: new THREE.Color(tint) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGround;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGround = ( modelMatrix * vec4( position, 1.0 ) ).xz;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
uniform float uIntensity;
uniform float uSigma;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uShadow;
uniform vec3 uTint;
varying vec2 vGround;`,
      )
      .replace(
        "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );",
        /* glsl */ `float r = length( vGround );
	float pool = uIntensity * exp( - ( r * r ) / ( uSigma * uSigma ) ) * ( 1.0 - smoothstep( uFadeStart, uFadeEnd, r ) );
	pool *= mix( 1.0 - uShadow, 1.0, getShadowMask() );
	gl_FragColor = vec4( uTint * pool, 1.0 );`,
      )
      .replace(
        "#include <colorspace_fragment>",
        /* glsl */ `#include <colorspace_fragment>
	gl_FragColor.rgb += step( 1e-7, pool ) * ( rand( gl_FragCoord.xy ) + rand( gl_FragCoord.yx + 19.19 ) - 1.0 ) / 255.0;`,
      );
  };
  // Distinct cache key so three never shares this program with a plain ShadowMaterial.
  material.customProgramCacheKey = () => "ground-pool";

  return { geometry, material, uniforms };
}
