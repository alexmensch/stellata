precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

// Bounded volumetric raymarch through per-instance Local Group proxy
// volumes — the milkyway.frag.glsl scheme (unit-sphere entry/exit,
// camera-inside clamp, log-distributed steps, magnitude gate folded
// into the tone-map exponent) minus dust, with profile parameters on
// flat varyings instead of uniforms. density0 values come solved from
// the build (docs/science-local-group.md § Local Group luminosity model) — do NOT scale
// them per-object here; per-object flux ratios are physical.
// CPU mirror: local-group-emission-pure.ts — keep the raymarch scheme
// and density functions in lockstep or the calibration test lies.

in vec3 vMeshLocalPos;
in vec3 vWorldPos;
flat in vec3 vCamLocal;
flat in vec3 vAxes;
flat in vec3 vColor;
#ifdef FAMILY_DISC
flat in vec3 vDisc;
flat in vec4 vBulge;
flat in vec2 vBulgeExt;
#else
flat in vec4 vSersic;
flat in float vUMax;
#endif

out vec4 fragColor;

uniform float uBrightnessScale;
uniform float uMaxAppMag;     // shared with star pipeline
uniform float uSizeSpan;      // shared with star pipeline
uniform float uGlowMagOffset; // calibration: integrated column → appMag

const int   STEPS = 32;
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
  float rho = vDisc.x * exp(-R * vDisc.y - abs(phys.z) * vDisc.z);
  if (vBulge.x > 0.0) {
    // Solver contract (scripts/local-group/README.md § Emission solver):
    // bulge emission exists only for u ≤ uMax; dropping the cut here
    // drifts the bulge flux from its solved calibration.
    float u = length(phys) * vBulgeExt.x;
    if (u <= vBulgeExt.y) rho += vBulge.x * sersicNu(u, vBulge.y, vBulge.z, vBulge.w);
  }
  return rho;
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

  float accum = 0.0;
  float prevS = sStart;
  for (int i = 0; i < STEPS; i++) {
    float sBoundary = exp(logMin + float(i + 1) * logStep);
    float sMid = exp(logMin + (float(i) + 0.5) * logStep);
    float dsPc = sBoundary - prevS;
    prevS = sBoundary;
    float t = sMid / worldPerT;
    vec3 pLocal = vCamLocal + t * dirLocal;
    if (dot(pLocal, pLocal) > 1.001) break;
    accum += densityAt(pLocal) * dsPc;
  }

  float appMag = uGlowMagOffset - 2.5 * log(max(accum, 1e-12)) / LOG10;
  float gate = max((uMaxAppMag - appMag) / max(uSizeSpan, 0.001), 0.0);
  vec3 result = vec3(1.0) - exp(-vColor * accum * uBrightnessScale * gate);
  fragColor = vec4(result, 1.0);
}
