precision highp float;

#include <common>
#include <stellata_atmosphere_scatter>

// uMap and uNightMap are always bound (1×1 white placeholder when the
// body has no texture) — sampling an unbound texture is undefined in
// WebGL.
uniform sampler2D uMap;
uniform float uHasMap;
uniform sampler2D uNightMap;
uniform float uHasNight;
uniform vec3 uColour;
// Planet → host-star direction in VIEW space; per-fragment Lambert
// against it is what produces the day/night terminator.
uniform vec3 uSunDirView;
uniform float uFade;
// φ_body(α)/φ_Lambert(α), CPU-computed via phase-function.ts
// (phaseRatioToLambert) and clamped there — corrects the Lambert
// disc-integrated output to the body's measured phase curve.
uniform float uPhaseScale;
// Host-distance × slider-sensitivity display intensity, CPU-computed
// via perceptual-magnitude.ts (litIntensity).
uniform float uLitIntensity;
// Terminator softness half-width on dot(n, sunDir); 0 = airless hard
// cut (Planet.terminatorSoftness).
uniform float uTermSoftness;
// View-space shadow casters (xyz centre, w radius) — a moon's parent,
// or a planet's moons. Count mirrors MAX_SHADOW_CASTERS in
// body-shadow-pure.ts, the vitest-pinned CPU mirror of the loop below.
const int MAX_CASTERS = 8;
uniform vec4 uCasters[MAX_CASTERS];
uniform int uCasterCount;
// Host angular radius from the body — penumbra half-width per unit
// distance along the sun ray.
uniform float uSunAngRad;
// Atmosphere airlight over the lit disc (final = surface·T_view + L_air).
// uHasAtmosphere gates the whole block; the rest mirror the shell shader.
uniform float uHasAtmosphere;
uniform vec3 uCenterView;
uniform float uRadiusPc;
uniform float uAtmoRadius;
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uBetaRayleigh;
uniform float uBetaMie;
uniform vec3 uBetaAbsorb;
uniform float uMieG;
uniform vec3 uSunColour;

in vec3 vNormalV;
in vec3 vPosV;
in vec2 vUvM;

out vec4 outColor;

// Limb darkening: full brightness face-on, dimming toward the
// silhouette. Carries the whole visual character of texture-less
// bodies (Uranus) and reads subtly on textured ones.
const float LIMB_FLOOR = 0.45;
const float LIMB_EXP = 0.5;

// Night-lights crossfade half-width on dot(n, sunDir): the emissive
// term ramps in across ±this band around the geometric terminator so
// the day-texture → city-lights handoff has no hard seam.
const float NIGHT_RAMP = 0.05;

// Night-lights emissive scale. The Black Marble source is a deeply
// stretched long exposure — at map value the night side reads as
// bright as the day side, when to the naked eye city lights are faint
// specks on a near-black hemisphere. Tune at smoke.
const float NIGHT_INTENSITY = 0.2;

void main() {
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(-vPosV);
  float sunCos = dot(n, uSunDirView);
  // Lambert cosine away from the terminator; a smoothstep band of
  // half-width uTermSoftness carries twilight past it on atmospheric
  // bodies. The 1e-4 floor keeps the airless w=0 case a hard cut
  // without a divide-by-zero smoothstep.
  float w = max(uTermSoftness, 1e-4);
  float dayside = smoothstep(-w, w, sunCos) * max(sunCos, w);
  // Inter-body shadows: attenuate per caster on the ray toward the sun.
  // Penumbra half-width grows as tAlong·uSunAngRad, so shadows are
  // soft-edged and the antumbral (annular) case falls out naturally.
  // Mirrors casterShadowFactor in body-shadow-pure.ts.
  float shadow = 1.0;
  for (int i = 0; i < MAX_CASTERS; i++) {
    if (i >= uCasterCount) break;
    vec3 d = uCasters[i].xyz - vPosV;
    float tAlong = dot(d, uSunDirView);
    if (tAlong <= 0.0) continue;
    float missPc = length(d - tAlong * uSunDirView);
    float pen = max(tAlong * uSunAngRad, 1e-30);
    shadow *= smoothstep(uCasters[i].w - pen, uCasters[i].w + pen, missPc);
  }
  float ndotv = clamp(dot(n, v), 0.0, 1.0);
  float limb = mix(LIMB_FLOOR, 1.0, pow(ndotv, LIMB_EXP));
  vec3 base = mix(uColour, texture(uMap, vUvM).rgb, uHasMap);
  // Emissive, not reflective: no limb darkening, phase scale, host
  // intensity, or shadow on the lights.
  float nightRamp = 1.0 - smoothstep(-NIGHT_RAMP, NIGHT_RAMP, sunCos);
  vec3 night = texture(uNightMap, vUvM).rgb * nightRamp * uHasNight * NIGHT_INTENSITY;
  vec3 reflected = base * dayside * limb * uPhaseScale * uLitIntensity * shadow;
  vec3 col = reflected + night;

  if (uHasAtmosphere > 0.5) {
    // Airlight in front of this surface fragment + the transmittance the
    // surface radiance loses on its way out through the atmosphere.
    vec3 dir = normalize(vPosV);
    vec3 o = -uCenterView / uRadiusPc;
    float tStop = length(vPosV) / uRadiusPc;
    float b = dot(o, dir);
    float discA = b * b - (dot(o, o) - uAtmoRadius * uAtmoRadius);
    float tStart = discA > 0.0 ? max(-b - sqrt(discA), 0.0) : 0.0;
    vec3 inscatter;
    vec3 transmittance;
    stellata_atmosphereRadiance(
      o, dir, tStart, tStop, uAtmoRadius, uSunDirView,
      uScaleHeightR, uScaleHeightM, uBetaRayleigh, uBetaMie, uBetaAbsorb, uMieG,
      stellata_atmoJitter(gl_FragCoord.xy),
      inscatter, transmittance);
    col = col * transmittance + inscatter * uSunColour * uLitIntensity;
  }

  outColor = vec4(col, uFade);
}
