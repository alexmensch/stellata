precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_fragment>

// Absorption pass: a jittered raymarch accumulates the sightline A_V and
// emits an alpha-only premultiplied-over fragment (rgb = 0) that dims
// every diffuse layer drawn behind the mesh. Traced clouds (USE_FIELD)
// integrate the per-cloud Edenhofer density brick — the exact field the
// rim isosurface was traced from, so shadow and silhouette agree 1:1;
// fallback clouds integrate the calibrated Plummer model
// (docs/science-molecular-clouds.md §§ 4, 9). Sampling rules: § 9.1.
// CPU mirror of the analytic density/alpha math: cloud-presence-pure.ts.

const float TAU_PER_AV = 0.921;
const float AV_RATE_PER_NH = 1.65e-3;
const float ALPHA_CAP = 0.95;
// Beyond this column the alpha cap has long saturated — stop marching.
const float AV_SATURATED = 6.0;

#ifdef USE_FIELD
precision highp sampler3D;
// A_V per E_ZGR — the dust manifest's avPerDensityPerPc.
const float AV_PER_DENSITY = 2.742;
uniform sampler3D uBrick;
uniform float uDensityMax;
uniform vec3 uCenterFromAabb; // centerAbs − brick aabbMin, pc
uniform mat3 uRotMat;         // cloud-local → world
uniform vec3 uUvwScale;       // 1 / (stepPc · dims)
uniform vec3 uUvwBias;        // 0.5 / dims (texel-centre alignment)
#endif

// Per-cloud calibrated density model (clouds.json v3). For USE_FIELD
// materials uUEnv is the brick's taper edge (1.05), not the analytic
// mass-budget envelope — the brick already carries the true shape.
uniform vec3 uAxes;
uniform float uN0Cal;
uniform float uRflat;
uniform float uP;
uniform float uUEnv;
// Dev-console lever.
uniform int uSteps;
// Shared by reference with the star pipeline.
uniform float uFovYRad;
uniform vec2 uViewport;

in vec3 vPosUnit;
in vec3 vCamUnit;

layout(location = 0) out vec4 outColor;
// Attachment 2 carries the diffuse emitters until the resolve convolves it,
// and one blend equation covers every attachment — so the same alpha-only
// texel written here is what dims the band and the LG glow
// (../hdr/summation/README.md § Everything that dims the field).
layout(location = 2) out vec4 outDiffuse;

// Interleaved gradient noise of gl_FragCoord — static per pixel, never
// reseeded per frame (§ 9.1 rules 3–4: animated jitter shimmers).
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
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
  // projected pixel extent can show.
  float chordPc = (t1 - t0) * dlPerT;
  float midDistPc = max(0.5 * (t0 + t1) * dlPerT, 1e-6);
  float footprintMidPc = midDistPc * uFovYRad / uViewport.y;
  int steps = clamp(int(chordPc / max(footprintMidPc, 1e-6)), 4, uSteps);
  float dt = (t1 - t0) / float(steps);
  float stepPc = dt * dlPerT;

  float jitter = ign(gl_FragCoord.xy);

  float av = 0.0;
  for (int i = 0; i < steps; i++) {
    if (av > AV_SATURATED) break;
    float t = t0 + (float(i) + jitter) * dt;
    vec3 pu = ro + rd * t;
#ifdef USE_FIELD
    vec3 off = uCenterFromAabb + uRotMat * (pu * uAxes);
    float d = texture(uBrick, off * uUvwScale + uUvwBias).r * uDensityMax;
    av += AV_PER_DENSITY * d * stepPc;
#else
    float u = length(pu);
    float env = 1.0 - smoothstep(0.85 * uUEnv, uUEnv, u);
    if (env <= 0.0) continue;
    float q = (u * uAxes.z) / uRflat;
    av += AV_RATE_PER_NH * uN0Cal * pow(1.0 + q * q, -0.5 * uP) * env * stepPc;
#endif
  }

  float alpha = min(1.0 - exp(-TAU_PER_AV * av), ALPHA_CAP);

  // ±0.5-LSB output dither (§ 9.1 rule 4).
  float dith = (ign(gl_FragCoord.xy + 113.7) - 0.5) / 255.0;
  outColor = vec4(vec3(0.0), clamp(alpha + dith, 0.0, ALPHA_CAP));
  outDiffuse = outColor;
}
