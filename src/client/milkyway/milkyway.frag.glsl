precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>
// The unit + the operator + the shared extended-source write tail. The
// isobar pass needs the raw magnitude too, which is why the column and
// the tail stay separate steps here. See src/client/hdr/README.md § Unit.
#include <stellata_extended_emitter>

// Bounded volumetric raymarch through proxy meshes.
//
// Two proxy meshes (a flattened disc, an oblate bulge) define
// integration volumes centred on the galactic centre. For each
// fragment, we raymarch from front-face entry (or camera position if
// the camera is inside the mesh) to the back-face fragment, evaluating
// the component's density function and accumulating emission with
// running dust extinction. The two meshes' contributions add via the
// material's additive blending.
//
// Why volumetric instead of surface-only emission:
//   - Surface-only evaluates density at one point per fragment, which
//     can't capture the band's defining anisotropy: long edge-on path
//     through the disc → bright band; short out-of-plane path →
//     dim glow; both should be smooth and continuous. Volumetric
//     integration produces this naturally — the silhouette of the
//     proxy mesh fades smoothly to zero as the path through the volume
//     shrinks to nothing.
//   - The earlier surface-only attempt used `pow(|n·v|, k)` to soften
//     hard mesh outlines, but that's a hack: it just dims the
//     silhouette; it doesn't represent the actual integrated emission.
//
// Why analytical-only dust (no voxel sampling):
//   - The Edenhofer voxel grid has ~5 pc native resolution, designed
//     for short per-star sightlines. Sampling it at coarse step
//     intervals along the long camera→fragment ray (8-15 kpc) aliases
//     into visible parallel streaks regardless of step distribution.
//   - The molecular cloud layer (renderOrder = -2) renders named SF
//     clouds as proper 3D ellipsoids and provides the discrete cloud
//     detail in front of the band.
//   - The voxel grid stays in use for per-star extinction
//     (star.vert.glsl), where short rays + dense per-star sampling
//     work cleanly.

in vec3 vMeshLocalPos;
in vec3 vWorldPos;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 outStatistic;

// Auto-injected by ShaderMaterial:
//   uniform vec3 cameraPosition;  // renderer-local

// Floating-origin offset (renderer-local + uWorldOffset = absolute ICRS).
// We don't actually need absolute coords here since both galactic centre
// and the camera are computed in renderer-local frame, but keep it
// available for any future per-step absolute lookups.
uniform vec3 uWorldOffset;

// Galactic-frame transform.
uniform mat3 uIcrsToGal;        // ICRS axes → galactic axes
uniform vec3 uGalCenter;        // GALACTIC_CENTRE_PC - worldOffset (renderer-local)

// Mesh half-extents in pc (galactic-frame X, Y, Z under mesh.scale).
uniform vec3 uMeshScalePc;

// Component flag: false = disc, true = bulge.
uniform bool uIsBulge;

// Stellar (emission) density profile parameters.
uniform float uDiscScaleLengthPc;   // hR
uniform float uDiscScaleHeightPc;   // hz
uniform float uBulgeScaleRadiusPc;  // r_b
uniform float uBulgeAxisRatio;      // q (oblate flattening)
uniform float uDensity0;            // peak density normalisation
uniform vec3  uColor;               // population palette

uniform float uR0Pc;  // Sol galactocentric radius

// Analytical disc dust profile (no voxel sampling — see top comment).
uniform float uAnalyticalDustScaleLengthPc;
uniform float uAnalyticalDustScaleHeightPc;
uniform float uAnalyticalDustNormPerPc;
uniform float uDustAvPerDensityPc;
uniform float uDustEnabled;
uniform float uExtinctionStrength;

// Wavelength-dependent extinction multipliers on τ_V. CCM ratios:
// (0.751, 1.0, 1.32) → red transmits most, blue extincts most → warm
// amber tint emerges from behind heavy dust columns.
uniform vec3 uReddeningRGB;

// HDR seam, bound by reference from HdrPipeline.emitterUniforms.
uniform float uHdrTarget;      // 1 = target bound, emit linear L untouched
uniform float uWhitePoint;
uniform float uHighlightDesat;
uniform float uExposure;
uniform float uOmegaPxArcsec2;        // pixel solid angle, arcsec²
uniform float uOmegaSummationArcsec2; // rod summation solid angle, arcsec²

// Output controls.
uniform float uLimitMag;      // shared with star pipeline (chart isobar)
uniform float uGlowMagOffset; // V surface brightness at colorAccum = 1

// Chart-mode isobar pass. When > 0.5 the fragment renders only a thin
// outline at the iso-line where the sightline's surface brightness crosses
// the instrument's extended-source detection threshold.
uniform float uChartIsobar;
uniform vec3  uChartInkColor;

// Raymarch resolution. 32 log-distributed steps over distance-from-
// camera. Log spacing concentrates samples near the camera (where
// dust + density vary fastest) and spreads the rest over the longer
// far portion of the ray.
const int   STEPS = 32;
const float S_MIN_PC = 1.0;
const float MAG_PER_TAU = 1.0857;

// Deliberately linear rather than log-distributed like the march below:
// this span's integrand rises toward its FAR end. See README.md
// § Foreground dust.
const int FOREGROUND_DUST_STEPS = 16;

// --- Density functions ----------------------------------------------

// `footprintPc` / `zFootprintPc` smooth the profile over one pixel's
// transverse footprint so a point-sampled fragment carries the pixel's area
// average (../hdr/emission.glsl). From Sol they are metres against a 300 pc
// scale height and change nothing; from outside the Galaxy they are what
// keeps the band comparable with a Local Group object at the same distance.
float discDensityVal(float R, float zVal, float footprintPc, float zFootprintPc) {
  return uDensity0
       * exp(-(stellataSoftenRadius(R, footprintPc) - uR0Pc) / uDiscScaleLengthPc)
       * exp(-stellataSoftenRadius(abs(zVal), zFootprintPc) / uDiscScaleHeightPc);
}

float bulgeDensityVal(float R, float zVal, float footprintPc) {
  float zEff = zVal / uBulgeAxisRatio;
  float rPrime = stellataSoftenRadius(sqrt(R * R + zEff * zEff), footprintPc);
  return uDensity0 * exp(-rPrime / uBulgeScaleRadiusPc);
}

float analyticalDustDensity(float R, float zVal) {
  return uAnalyticalDustNormPerPc
       * exp(-(R - uR0Pc) / uAnalyticalDustScaleLengthPc)
       * exp(-abs(zVal) / uAnalyticalDustScaleHeightPc);
}

// Per-channel optical depth of one step, CCM reddening applied to τ_V.
vec3 dustTauStepRGB(float R, float zVal, float dsPc, float dustEffective) {
  if (dustEffective <= 0.0) return vec3(0.0);
  float kappaPerPcV = analyticalDustDensity(R, zVal)
                    * uDustAvPerDensityPc * dustEffective / MAG_PER_TAU;
  return kappaPerPcV * uReddeningRGB * dsPc;
}

// The integration volume starts at the mesh front face; the dust slab
// does not. A component the camera sits outside of — the bulge, from
// anywhere in the disc — has to emit through this column first.
vec3 foregroundDustTau(vec3 originGalCentric, vec3 dirGalCentric,
                       float sStart, float worldPerT, float dustEffective) {
  if (dustEffective <= 0.0 || sStart <= S_MIN_PC) return vec3(0.0);
  vec3 tau = vec3(0.0);
  float dsPc = (sStart - S_MIN_PC) / float(FOREGROUND_DUST_STEPS);
  for (int i = 0; i < FOREGROUND_DUST_STEPS; i++) {
    float sMid = S_MIN_PC + (float(i) + 0.5) * dsPc;
    vec3 pos = originGalCentric + (sMid / worldPerT) * dirGalCentric;
    tau += dustTauStepRGB(length(pos.xy), pos.z, dsPc, dustEffective);
  }
  return tau;
}

// --- Main -----------------------------------------------------------

void main() {
  #include <logdepthbuf_fragment>

  // --- Camera in mesh-local (unit sphere) frame -----------------------
  // Renderer-local → galactocentric ICRS → galactocentric galactic →
  // mesh-local (component-wise divide by half-axes).
  vec3 camGalCentric = uIcrsToGal * (cameraPosition - uGalCenter);
  vec3 camLocal = camGalCentric / uMeshScalePc;

  // --- Ray entry/exit in mesh-local frame -----------------------------
  // Ray runs camLocal → vMeshLocalPos. Don't normalise; under non-
  // uniform mesh scale, the local-frame "length" is direction-dependent
  // (meaningless), so we keep dirLocal in its natural mesh-local units.
  // t=0 at camera, t=1 at the back-face fragment (which is on the unit
  // sphere by construction).
  vec3 dirLocal = vMeshLocalPos - camLocal;
  float a = dot(dirLocal, dirLocal);
  float b = dot(camLocal, dirLocal);
  float c = dot(camLocal, camLocal) - 1.0;
  float disc = b * b - a * c;
  if (disc < 0.0) {
    stellataEmitNothing(fragColor, outStatistic);
    return;
  }
  float sqrtDisc = sqrt(disc);
  // Front-face entry (smaller root). Camera inside ⇒ tEnter < 0 ⇒ clamp.
  float tEnter = max((-b - sqrtDisc) / a, 0.0);
  // Back-face exit IS the fragment by construction — t = 1.
  float tExit = 1.0;
  if (tEnter >= tExit) {
    stellataEmitNothing(fragColor, outStatistic);
    return;
  }

  // --- Distances in world parsecs -------------------------------------
  // dirLocal spans [0, 1] across camera→fragment. The world-space
  // length of one t-unit is |vWorldPos - cameraPosition|, which we use
  // to convert mesh-local t-units into physical pc step size for the
  // raymarch. Both operands are renderer-local with small magnitudes
  // (floating-origin keeps them near zero), so this subtraction is
  // float-stable.
  float worldPerT = length(vWorldPos - cameraPosition);
  float sStart = max(tEnter * worldPerT, S_MIN_PC);
  float sEnd = worldPerT;
  if (sStart >= sEnd) {
    stellataEmitNothing(fragColor, outStatistic);
    return;
  }
  float logMin = log(sStart);
  float logMax = log(sEnd);
  float logStep = (logMax - logMin) / float(STEPS);

  // --- Volumetric raymarch --------------------------------------------
  // Per step:
  //   - Evaluate component density (emission per pc).
  //   - Evaluate analytical dust density → per-channel τ via CCM
  //     reddening.
  //   - Beer-Lambert: emission × dsPc × transmission(camera→step), with
  //     a half-step self-shielding term so a uniform slab integrates
  //     correctly.
  //   - Accumulate τ for next step.
  vec3 colorAccum = vec3(0.0);
  float prevS = sStart;

  float dustEffective = uDustEnabled * uExtinctionStrength;
  vec3 dirGalCentric = dirLocal * uMeshScalePc;
  vec3 tauAccum = foregroundDustTau(
    camGalCentric, dirGalCentric, sStart, worldPerT, dustEffective);
  float zFootprintScale =
    stellataFootprintAlong(normalize(dirGalCentric), vec3(0.0, 0.0, 1.0));

  for (int i = 0; i < STEPS; i++) {
    float sBoundary = exp(logMin + float(i + 1) * logStep);
    float sMid = exp(logMin + (float(i) + 0.5) * logStep);
    float dsPc = sBoundary - prevS;
    prevS = sBoundary;

    float t = sMid / worldPerT;
    vec3 pLocal = camLocal + t * dirLocal;
    // Outside the unit sphere → outside the mesh's integration volume.
    // Stop integrating (boundary samples can drift slightly past 1.0
    // due to log-stepping rounding).
    if (dot(pLocal, pLocal) > 1.001) break;

    vec3 posGalCentric = pLocal * uMeshScalePc;
    float R = length(posGalCentric.xy);
    float zVal = posGalCentric.z;

    float footprintPc = stellataFootprintPc(sMid, uOmegaPxArcsec2);
    float densityVal = uIsBulge
      ? bulgeDensityVal(R, zVal, footprintPc)
      : discDensityVal(R, zVal, footprintPc, footprintPc * zFootprintScale);

    vec3 dTauRGB = dustTauStepRGB(R, zVal, dsPc, dustEffective);

    // Beer-Lambert with half-step self-shielding for the slab approx.
    vec3 transmittance = exp(-tauAccum) * exp(-0.5 * dTauRGB);
    colorAccum += densityVal * uColor * transmittance * dsPc;
    tauAccum += dTauRGB;
  }

  // uGlowMagOffset states the V surface brightness a unit column carries,
  // so this sightline reads S = uGlowMagOffset - 2.5*log10(column). Only
  // the isobar needs the magnitude domain; the emission path takes the
  // round-trip as one scalar gain inside stellataEmitExtendedSource.
  // Computed outside the branch so fwidth stays in uniform control flow.
  float column = max(dot(colorAccum, STELLATA_LUMA_WEIGHTS), 1e-12);
  float sb = uGlowMagOffset - 2.5 * log(column) / STELLATA_LOG10;

  if (uChartIsobar > 0.5) {
    // Single solid contour where the sightline's SURFACE BRIGHTNESS crosses
    // the extended-source threshold. Surface brightness carries no Ω_px
    // term, so the line is FOV- and viewport-invariant — a chart's band
    // outline is a fixed feature of the sky, not of the plate scale. Use
    // fwidth so the line is a constant 1 px wide regardless of how steep
    // the local gradient is — flat regions of the band would otherwise
    // paint a wide smudge and steep regions a hairline.
    float fw = max(fwidth(sb), 1e-5);
    float thresholdSb = stellataExtendedThresholdSb(uOmegaSummationArcsec2, uLimitMag);
    float line = 1.0 - smoothstep(fw * 0.5, fw * 1.5, abs(sb - thresholdSb));
    if (line <= 0.0) {
      stellataEmitNothing(fragColor, outStatistic);
      return;
    }
    fragColor = vec4(uChartInkColor * line, line);
    outStatistic = vec4(0.0);
    return;
  }

  // Displayed at the rod summation solid angle: the band's structure scale
  // from Sol is degrees, so it is uniform over the eye's summation area and
  // threshold belongs where the eye's is (../hdr/README.md § Extended
  // sources). The statistic stays on Ω_px — it measures light, not display.
  stellataEmitExtendedSource(
    colorAccum,
    uExposure, uGlowMagOffset, uOmegaSummationArcsec2, uOmegaPxArcsec2,
    uHdrTarget, uWhitePoint, uHighlightDesat,
    fragColor, outStatistic);
}
