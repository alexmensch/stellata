precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_fragment>
#include <stellata_fresnel_rim>

// Presence pass: one band-limited raymarch of the calibrated density
// model (docs/molecular-clouds.md §§ 4–5) drives an absorption alpha
// (dims diffuse layers drawn behind the mesh), a fresnel-rim whisper
// glow (the Local-Bubble-style orientation silhouette), and the
// chart-mode isobar contour. Sampling rules: § 9.1. CPU mirror of the
// noise/density math: cloud-presence-pure.ts.

const int MAX_OCT = 12;
const float TAU_PER_AV = 0.921;
const float AV_RATE_PER_NH = 1.65e-3;
const float NOISE_NORM = 2.49;
const float ISOBAR_AV_AT_NAKED_EYE = 1.5;
const float ISOBAR_AV_AT_ALL = 0.05;
// A sample whose noise-free column contribution is below this skips the
// octave loop entirely — the Plummer outskirts dominate projected area
// but not the column, and even a +clamp-σ excursion on a skipped sample
// stays under ~0.02 alpha.
const float NOISE_SKIP_AV = 0.002;
// Beyond this column the alpha cap (0.95) has long saturated — stop
// marching.
const float AV_SATURATED = 6.0;

// Per-cloud calibrated density model (clouds.json v2).
uniform vec3 uAxes;
uniform float uN0Cal;
uniform float uRflat;
uniform float uP;
uniform float uUEnv;
uniform float uSigmaS;
uniform uint uSeed;
uniform float uRidgedExp;
uniform vec3 uTint;
// Octave ladder — buildOctaveLadder over the clouds.json noiseModel
// block (single source of truth; never redefined here).
uniform float uOctLambda[MAX_OCT];
uniform float uOctAmp[MAX_OCT];
uniform int uNumOct;
uniform float uDomainStretch;
uniform float uClampSigma;
uniform int uRidgedCount;
// Dev-console levers.
uniform int uSteps;
uniform float uOpacity;
uniform float uAlphaLimb;
uniform float uFaceOnFloor;
uniform float uFresnelPower;
uniform float uTexGain;
// Shared by reference with the star pipeline.
uniform float uMaxAppMag;
uniform float uFovYRad;
uniform vec2 uViewport;
// Mode flags.
uniform float uMonochrome;
uniform vec3 uMonoColor;
uniform float uChartIsobar;

in vec3 vPosUnit;
in vec3 vCamUnit;

out vec4 outColor;

// Interleaved gradient noise of gl_FragCoord — static per pixel, never
// reseeded per frame (§ 9.1 rules 3–4: animated jitter shimmers).
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

float latticeValue(ivec3 c, uint seed) {
  uvec3 h = pcg3d(uvec3(c) + seed);
  return float(h.x) * (2.0 / 4294967295.0) - 1.0;
}

float quinticW(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float valueNoise(vec3 p, uint seed) {
  vec3 fl = floor(p);
  ivec3 i = ivec3(fl);
  vec3 w = vec3(quinticW(p.x - fl.x), quinticW(p.y - fl.y), quinticW(p.z - fl.z));
  float n00 = mix(latticeValue(i, seed), latticeValue(i + ivec3(1, 0, 0), seed), w.x);
  float n10 = mix(latticeValue(i + ivec3(0, 1, 0), seed), latticeValue(i + ivec3(1, 1, 0), seed), w.x);
  float n01 = mix(latticeValue(i + ivec3(0, 0, 1), seed), latticeValue(i + ivec3(1, 0, 1), seed), w.x);
  float n11 = mix(latticeValue(i + ivec3(0, 1, 1), seed), latticeValue(i + ivec3(1, 1, 1), seed), w.x);
  return mix(mix(n00, n10, w.y), mix(n01, n11, w.y), w.z);
}

uint octaveSeed(int k) {
  return uSeed + uint(k) * 668265261u;
}

void main() {
  #include <logdepthbuf_fragment>

  // Ray through the envelope sphere u = uUEnv (analytic, so BackSide
  // fragments give the identical segment from outside and inside).
  // Density is identically zero outside the envelope, so clipping the
  // march to it concentrates the step budget on nonzero density — and
  // for mass-budget-tightened clouds (uEnv ≪ 1) discards most of the
  // projected disc in one dot product.
  vec3 ro = vCamUnit;
  vec3 rd = normalize(vPosUnit - vCamUnit);
  float b = dot(ro, rd);
  float roro = dot(ro, ro);
  float disc = b * b - (roro - uUEnv * uUEnv);
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  if (t1 - t0 < 1e-6) discard;

  float dlPerT = length(rd * uAxes);
  // Screen-adaptive step budget: never more steps than the chord's
  // projected pixel extent can show — the band-limit below then adapts
  // the octave set to the coarser step automatically.
  float chordPc = (t1 - t0) * dlPerT;
  float midDistPc = max(0.5 * (t0 + t1) * dlPerT, 1e-6);
  float footprintMidPc = midDistPc * uFovYRad / uViewport.y;
  int steps = clamp(int(chordPc / max(footprintMidPc, 1e-6)), 4, uSteps);
  float dt = (t1 - t0) / float(steps);
  float stepPc = dt * dlPerT;
  vec3 stretch = vec3(1.0 / uDomainStretch, 1.0, 1.0);

  // Band-limit split (§ 9.1 rule 1): only octaves with λ ≥ 2·step feed
  // the integral, faded by smoothstep — never a hard cut. The effective
  // included variance keeps the log-normal field mean-preserving.
  float wInt[MAX_OCT];
  float varInt = 0.0;
  for (int k = 0; k < uNumOct; k++) {
    float w = uOctAmp[k] * smoothstep(1.0, 2.0, uOctLambda[k] / (2.0 * stepPc));
    wInt[k] = w;
    varInt += w * w;
  }
  float clampLim = uClampSigma * sqrt(max(varInt, 1e-6));
  float meanOff = 0.5 * uSigmaS * uSigmaS * varInt;

  bool isobar = uChartIsobar > 0.5;
  float jitter = isobar ? 0.5 : ign(gl_FragCoord.xy);

  float av = 0.0;
  float peakN = 0.0;
  float peakT = t0;
  float gCache = 0.0;
  bool gValid = false;
  for (int i = 0; i < steps; i++) {
    if (av > AV_SATURATED) break;
    float t = t0 + (float(i) + jitter) * dt;
    vec3 pu = ro + rd * t;
    float u = length(pu);
    float env = 1.0 - smoothstep(0.85 * uUEnv, uUEnv, u);
    if (env <= 0.0) continue;
    float q = (u * uAxes.z) / uRflat;
    float n = uN0Cal * pow(1.0 + q * q, -0.5 * uP) * env;
    float baseAv = AV_RATE_PER_NH * n * stepPc;
    if (baseAv < NOISE_SKIP_AV) {
      av += baseAv;
      continue;
    }
    // The band-limit makes the in-integral field smooth at step scale
    // (octaves fade to zero below λ = 2Δ), so the octave sum is
    // evaluated on alternate steps and reused between them — half the
    // hash cost for imperceptible change.
    float g;
    if ((i & 1) == 0 || !gValid) {
      g = 0.0;
      vec3 pn = pu * uAxes * stretch;
      for (int k = 0; k < uNumOct; k++) {
        if (wInt[k] < 1e-4) continue;
        g += wInt[k] * valueNoise(pn / uOctLambda[k], octaveSeed(k));
      }
      g = clamp(g * NOISE_NORM, -clampLim, clampLim);
      gCache = g;
      gValid = true;
    } else {
      g = gCache;
    }
    n *= exp(uSigmaS * g - meanOff);
    av += AV_RATE_PER_NH * n * stepPc;
    if (n > peakN) { peakN = n; peakT = t; }
  }

  if (isobar) {
    // Single solid contour at an A_V iso-line driven by the magnitude
    // slider: naked-eye (6.5) shows only dense cores; all-stars (15)
    // migrates the line out toward the silhouette. fwidth-scaled
    // smoothstep gives an antialiased 1-px ink line.
    float avT = mix(ISOBAR_AV_AT_NAKED_EYE, ISOBAR_AV_AT_ALL,
                    clamp((uMaxAppMag - 6.5) / 8.5, 0.0, 1.0));
    float fw = max(fwidth(av), 1e-5);
    float line = 1.0 - smoothstep(fw * 0.5, fw * 1.5, abs(av - avT));
    if (line <= 0.0) discard;
    outColor = vec4(uMonoColor * line, line);
    return;
  }

  // Fine octaves as bounded post-integral texture (§ 9.1 rule 2),
  // evaluated at the densest sample: the sub-band-limit ladder — ridged
  // on the finest octaves (§ 5.3) — applies as one multiplicative
  // factor, clamped so it adds filamentary texture without adding
  // column variance. Octaves below the world-space pixel footprint
  // fade out (screen-space Nyquist).
  float tex = 1.0;
  if (peakN > 0.0) {
    vec3 pnP = (ro + rd * peakT) * uAxes * stretch;
    float footprintPc = peakT * dlPerT * uFovYRad / uViewport.y;
    float gt = 0.0;
    for (int k = 0; k < uNumOct; k++) {
      float wTex = uOctAmp[k]
        * (1.0 - smoothstep(1.0, 2.0, uOctLambda[k] / (2.0 * stepPc)))
        * smoothstep(1.0, 2.0, uOctLambda[k] / max(footprintPc, 1e-6));
      if (wTex < 1e-4) continue;
      float raw = valueNoise(pnP / uOctLambda[k], octaveSeed(k));
      float shaped = (k >= uNumOct - uRidgedCount)
        ? pow(1.0 - abs(raw), uRidgedExp) - 1.0 / (uRidgedExp + 1.0)
        : raw;
      gt += wTex * shaped;
    }
    tex = clamp(1.0 + uTexGain * NOISE_NORM * gt, 0.6, 1.4);
  }

  float alpha = min(1.0 - exp(-TAU_PER_AV * av * tex), 0.95);

  if (uMonochrome > 0.5) {
    float am = alpha * uOpacity;
    outColor = vec4(uMonoColor * am, am);
    return;
  }

  // Whisper glow: the shared fresnel-rim shape at the ray's envelope
  // entry point (the Local Bubble treatment), textured by the fine
  // octaves and faded at the envelope edge by the ray's closest
  // approach — geometric, NOT column-based: the fresnel peaks exactly
  // where the grazing column vanishes, so a column product would kill
  // the rim. Suppressed with the camera inside — the fresnel-shell
  // hide-when-inside contract, for the glow only; the absorption alpha
  // above keeps working from inside the cloud.
  float insideGate = smoothstep(uUEnv, 1.15 * uUEnv, length(ro));
  vec3 glow = vec3(0.0);
  if (insideGate > 0.0) {
    vec3 nrm = normalize((ro + rd * t0) / uAxes);
    vec3 viewDirPc = -normalize(rd * uAxes);
    float rimA = fresnelRimAlpha(nrm, viewDirPc, uAlphaLimb, uFaceOnFloor, uFresnelPower);
    float uClosest = sqrt(max(roro - b * b, 0.0));
    float presence = 1.0 - smoothstep(0.9 * uUEnv, uUEnv, uClosest);
    glow = uTint * (uOpacity * insideGate * rimA * tex * presence);
  }

  // ±0.5-LSB output dither (§ 9.1 rule 4): the whisper glow spans only
  // ~13–38 8-bit levels, so quantisation bands even with a perfect
  // integral.
  float dith = (ign(gl_FragCoord.xy + 113.7) - 0.5) / 255.0;
  outColor = vec4(glow + dith, clamp(alpha + dith, 0.0, 0.95));
}
