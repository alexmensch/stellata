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

uniform float uMaxAppMag;
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
in float vGlareIntensity;
in float vAaWidth;

out vec4 outColor;

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
    if (vAppMag > uMaxAppMag) discard;
    float aa = max(vAaWidth, 1e-3);
    float disc = 1.0 - smoothstep(0.5 - aa, 0.5, r);
    if (disc <= 0.0) discard;
    outColor = vec4(vec3(1.0 - disc), 1.0);
    return;
  }

  // Reflected glare — additive, always the fuzzy point-glow profile
  // (physRatio 0 ⇒ Gaussian n). vGlareIntensity carries the peak set in
  // planet.vert.glsl: the flux-conserving photographic base blended with
  // the intensity-gated veiling-glare bloom (bright surfaces reach peak
  // 1 like a star). The tap fades intensity to zero across the slider
  // threshold band.
  float glow = perceptualDiscProfile(
      r, vSoftness, 0.0,
      uVisibleThreshold, uVisibleK,
      uDistNMin, uDistNMax,
      uLumBiasMin, uLumBiasMax);
  float tap = 1.0 - smoothstep(uMaxAppMag, uMaxAppMag + 0.5, vAppMag);
  glow *= tap * vGlareIntensity;
  if (glow <= 0.0) discard;
  outColor = vec4(vColor * glow, glow);
}
