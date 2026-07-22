precision highp float;

#include <common>
#include <stellata_atmosphere_uniforms>
#include <stellata_atmosphere_scatter>

// uMap is always bound (1×1 white placeholder when the body has no texture)
// — sampling an unbound texture is undefined in WebGL.
uniform sampler2D uMap;
uniform float uHasMap;
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
// uHasAtmosphere gates the whole block; the scatter uniforms it reads are the
// shared contract (planet-atmosphere.frag.glsl reads the same set).
uniform float uHasAtmosphere;

in vec3 vNormalV;
in vec3 vPosV;
in vec2 vUvM;

out vec4 outColor;

// Limb darkening: full brightness face-on, dimming toward the
// silhouette. Carries the whole visual character of texture-less
// bodies (Uranus) and reads subtly on textured ones.
const float LIMB_FLOOR = 0.45;
const float LIMB_EXP = 0.5;

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
  // Atmospheric bodies: the scattering governs the limb, so the ad-hoc
  // surface limb-darkening is dropped (it double-darkened the disc edge into
  // a black rim). Airless bodies keep it as their whole limb character.
  float limb = uHasAtmosphere > 0.5 ? 1.0 : mix(LIMB_FLOOR, 1.0, pow(ndotv, LIMB_EXP));
  vec3 base = mix(uColour, texture(uMap, vUvM).rgb, uHasMap);
  vec3 col = base * dayside * limb * uPhaseScale * uLitIntensity * shadow;

  if (uHasAtmosphere > 0.5) {
    // Airlight in front of this surface fragment + the transmittance the
    // surface radiance loses on its way out. Reconstruct the surface point on
    // the SMOOTH sphere from the renormalized normal, not the faceted
    // position — the latter grids the analytic march to the tessellation.
    vec3 nrm = normalize(vNormalV);
    vec3 surf = uCenterView + uRadiusPc * nrm;
    vec3 dir = normalize(surf);
    vec3 o = -uCenterView / uRadiusPc;
    float tStop = length(surf) / uRadiusPc;
    float t0, t1;
    float discA = stellata_shellEntry(o, dir, uAtmoRadius, t0, t1);
    float tStart = discA > 0.0 ? max(t0, 0.0) : 0.0;
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
