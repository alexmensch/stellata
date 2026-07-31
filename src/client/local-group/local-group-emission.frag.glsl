precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>
#include <stellata_extended_emitter>

// Bounded volumetric raymarch through per-instance Local Group proxy
// volumes — the milkyway.frag.glsl scheme (unit-sphere entry/exit,
// camera-inside clamp, log-distributed steps) with profile parameters
// on flat varyings instead of uniforms, plus per-pixel sample jitter.
// density0 values come solved from the build (docs/science-local-group.md
// § Local Group luminosity model) — do NOT scale them per-object here;
// per-object flux ratios are physical.
// CPU mirror: local-group-emission-pure.ts — keep the raymarch scheme
// and density functions in lockstep or the calibration test lies. The
// mirror samples step midpoints; the jitter here is uniform over the
// step, so its expectation is the mirror's sample.

in vec3 vMeshLocalPos;
in vec3 vWorldPos;
flat in vec3 vCamLocal;
flat in vec3 vAxes;
flat in vec3 vColor;
#ifdef FAMILY_DISC
flat in vec3 vDisc;
#else
flat in vec4 vSersic;
flat in float vUMax;
#endif

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 outStatistic;

uniform float uExposure;
uniform float uOmegaPxArcsec2;
uniform float uHdrTarget;
uniform float uWhitePoint;
uniform float uHighlightDesat;

// EMISSION_STEPS is injected as a material define (per-family; see
// local-group-emission-pure.ts EMISSION_STEPS_*).
const int   STEPS = EMISSION_STEPS;
const float S_MIN_PC = 0.1;
const float U_FLOOR = 1e-4;
// Mirrors LG_SB_ZERO_POINT — a column is flux per steradian, so this is
// just the solid angle of one arcsec².
const float SB_ZERO_POINT = 26.5721256659;

float sersicNu(float u, float invN, float bn, float pn) {
  float uc = max(u, U_FLOOR);
  return pow(uc, -pn) * exp(-bn * pow(uc, invN));
}

float densityAt(vec3 pLocal) {
#ifdef FAMILY_DISC
  vec3 phys = pLocal * vAxes;
  float R = length(phys.xy);
  return vDisc.x * exp(-R * vDisc.y - abs(phys.z) * vDisc.z);
#else
  // Spheroid mesh axes are uMax × R_e, so the ellipsoidal radius in
  // R_e units is just uMax × the unit-ball radius.
  float u = length(pLocal) * vUMax;
  return vSersic.x * sersicNu(u, vSersic.y, vSersic.z, vSersic.w);
#endif
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 dirLocal = vMeshLocalPos - vCamLocal;
  float a = dot(dirLocal, dirLocal);
  float b = dot(vCamLocal, dirLocal);
  float c = dot(vCamLocal, vCamLocal) - 1.0;
  float disc = b * b - a * c;
  if (disc < 0.0) {
    stellataEmitNothing(fragColor, outStatistic);
    return;
  }
  float tEnter = max((-b - sqrt(disc)) / a, 0.0);
  if (tEnter >= 1.0) {
    stellataEmitNothing(fragColor, outStatistic);
    return;
  }

  float worldPerT = length(vWorldPos - cameraPosition);
  float sStart = max(tEnter * worldPerT, S_MIN_PC);
  float sEnd = worldPerT;
  if (sStart >= sEnd) {
    stellataEmitNothing(fragColor, outStatistic);
    return;
  }
  float logMin = log(sStart);
  float logStep = (log(sEnd) - logMin) / float(STEPS);

  // Per-pixel jitter of the in-step sample position: coherent
  // midpoint sampling of the thin-disc vertical profile bands on
  // grazing rays; jitter trades the bands for fine noise.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  float accum = 0.0;
  float prevS = sStart;
  for (int i = 0; i < STEPS; i++) {
    float sBoundary = exp(logMin + float(i + 1) * logStep);
    float sSample = exp(logMin + (float(i) + jitter) * logStep);
    float dsPc = sBoundary - prevS;
    prevS = sBoundary;
    float t = sSample / worldPerT;
    vec3 pLocal = vCamLocal + t * dirLocal;
    if (dot(pLocal, pLocal) > 1.001) break;
    accum += densityAt(pLocal) * dsPc;
  }

  // accum is Σρ·ds, which the solver's normalisation makes flux per
  // steradian, so SB_ZERO_POINT is the surface brightness of a unit
  // column. vColor carries hue only — it is luma-normalised on the CPU
  // side — so the scalar gain leaves the solved flux alone.
  stellataEmitExtendedSource(
    vColor * accum,
    uExposure, SB_ZERO_POINT, uOmegaPxArcsec2,
    uHdrTarget, uWhitePoint, uHighlightDesat,
    fragColor, outStatistic);
}
