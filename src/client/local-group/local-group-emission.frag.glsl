precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

// Bounded volumetric raymarch through per-instance Local Group proxy
// volumes — the milkyway.frag.glsl scheme (unit-sphere entry/exit,
// camera-inside clamp, log-distributed steps) with profile parameters
// on flat varyings instead of uniforms, per-pixel sample jitter, and a
// magnitude-domain tone map (see README § Emission layer: pixel
// brightness follows the gate, not linear column flux — the star
// pipeline's convention, NOT milkyway.frag's, which keeps linear
// column in the exponent and would point-source any external view).
// density0 values come solved from the build (SCIENCE.md § Local
// Group luminosity model) — do NOT scale them per-object here;
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

out vec4 fragColor;

uniform float uBrightnessScale;
uniform float uMaxAppMag;     // shared with star pipeline
uniform float uSizeSpan;      // shared with star pipeline
uniform float uGlowMagOffset; // calibration: integrated column → appMag

// EMISSION_STEPS is injected as a material define (per-family; see
// local-group-emission-pure.ts EMISSION_STEPS_*).
const int   STEPS = EMISSION_STEPS;
const float S_MIN_PC = 0.1;
const float LOG10 = 2.302585093;
const float U_FLOOR = 1e-4;

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
    fragColor = vec4(0.0);
    return;
  }
  float tEnter = max((-b - sqrt(disc)) / a, 0.0);
  if (tEnter >= 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  float worldPerT = length(vWorldPos - cameraPosition);
  float sStart = max(tEnter * worldPerT, S_MIN_PC);
  float sEnd = worldPerT;
  if (sStart >= sEnd) {
    fragColor = vec4(0.0);
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

  float appMag = uGlowMagOffset - 2.5 * log(max(accum, 1e-12)) / LOG10;
  float gate = max((uMaxAppMag - appMag) / max(uSizeSpan, 0.001), 0.0);
  vec3 result = vec3(1.0) - exp(-vColor * uBrightnessScale * gate);
  fragColor = vec4(result, 1.0);
}
