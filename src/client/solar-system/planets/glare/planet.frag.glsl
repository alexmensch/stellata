precision highp float;

#include <common>
#ifndef LOCAL_DEPTH_PASS
#include <logdepthbuf_pars_fragment>
#endif
// Shared radial-intensity profile. The planet glare renders with the
// same super-Gaussian I(r) the star pipeline's glow pass uses; the
// resolved surface is the spheroid mesh, so this billboard is glare
// only — never an opaque disc.
#include <stellata_perceptual_disc>
// The luminance unit — read here only for the statistic attachment's
// texel rule and LUMA_CEIL (../../../hdr/emission/README.md § Unit).
#include <stellata_hdr_emission>
// The scene-wide operator, applied inline whenever the frame is not
// rendering into the HDR target — see ../../../hdr/README.md § Fallback.
#include <stellata_tonemap>

// HDR seam, bound by reference from HdrPipeline.emitterUniforms.
uniform float uHdrTarget;      // 1 = target bound, emit linear L untouched
uniform float uWhitePoint;
uniform float uHighlightDesat;

uniform float uLimitMag;
uniform float uThresholdMag;
uniform float uMonochrome;
uniform float uVisibleThreshold;
uniform float uVisibleK;
uniform float uDistNMin;
uniform float uDistNMax;
uniform float uLumBiasMin;
uniform float uLumBiasMax;

in vec3 vColor;
in vec2 vUv;
in float vAppMag;
in float vSoftness;
in float vPeakL;
in float vFluxPeakL;
in float vAaWidth;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outStatistic;

void main() {
  float r = length(vUv);
  if (r > 0.5) discard;

  gl_FragDepth = gl_FragCoord.z;
  #ifndef LOCAL_DEPTH_PASS
  #include <logdepthbuf_fragment>
  #endif

  // Chart mode: flat hard-edged ink discs (MultiplyBlending), star.frag's
  // mono branch. The single glare material carries it — no phase glare on
  // paper.
  if (uMonochrome > 0.5) {
    if (vAppMag > uLimitMag) discard;
    float aa = max(vAaWidth, 1e-3);
    float disc = 1.0 - smoothstep(0.5 - aa, 0.5, r);
    if (disc <= 0.0) discard;
    outColor = vec4(vec3(1.0 - disc), 1.0);
    outStatistic = vec4(0.0);
    return;
  }

  // Reflected glare — additive, always the fuzzy point-glow profile
  // (physRatio 0 ⇒ Gaussian n), identical to the star glow pass: a
  // planet reads as a star of its magnitude. The profile is a unit-peak
  // display kernel and vPeakL the body's physical luminance, so the
  // product is linear light in the scene-wide unit. The tap fades emitted
  // luminance to zero across the just-visible threshold band.
  float glow = perceptualDiscProfile(
      r, vSoftness, 0.0,
      uVisibleThreshold, uVisibleK,
      uDistNMin, uDistNMax,
      uLumBiasMin, uLumBiasMax);
  float tap = 1.0 - smoothstep(uThresholdMag, uThresholdMag + 0.5, vAppMag);
  glow *= tap;
  if (glow <= 0.0) discard;

  // Alpha stays the kernel value, exactly as the star glow pass does it:
  // AdditiveBlending multiplies rgb by it, which is what gives the pass its
  // squared falloff. Undithered — glare quads overlap each other and the
  // star field, and the dither is a function of fragCoord alone.
  vec3 emitted = vColor * (vPeakL * glow);
  // Alpha 1 on the statistic attachment: one blend equation runs over both,
  // so the additive pass's SrcAlpha factor would scale the flux channel a
  // second time and its integral would come out short.
  outStatistic = stellataStatisticTexel(vFluxPeakL * glow, vPeakL * glow, 1.0);
  if (uHdrTarget > 0.5) {
    outColor = vec4(emitted, glow);
    return;
  }
  outColor = vec4(
      stellataTonemapUndithered(emitted, uWhitePoint, uHighlightDesat), glow);
}
