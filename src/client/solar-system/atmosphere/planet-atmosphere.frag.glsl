precision highp float;

#include <common>
#include <stellata_atmosphere_uniforms>
#include <stellata_atmosphere_scatter>
#include <stellata_hdr_emission>
#include <stellata_tonemap>

// HDR seam, bound by reference from HdrPipeline.emitterUniforms.
uniform float uHdrTarget;      // 1 = target bound, emit linear L untouched
uniform float uWhitePoint;
uniform float uHighlightDesat;

// Body → host direction (unit, view space); host irradiance in the
// scene-wide HDR unit (the same scalar the mesh's own airlight block
// rides); and the LOD crossfade weight — not part of the shared scatter
// contract (the mesh shader uses these outside its atmosphere block too).
uniform vec3 uSunDirView;
uniform float uAirlightLuminance;
uniform float uFade;

in vec3 vPosV;
in vec3 vNormalV;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outStatistic;
// Attachment 2 holds the diffuse emitters until the resolve convolves them,
// and the shell is drawn in front of them — the same opacity that extincts
// the stars behind it (../../hdr/attachments/README.md § The gate).
layout(location = 2) out vec4 outDiffuse;

void main() {
  // Reconstruct the shell-surface point on the SMOOTH sphere from the
  // renormalized normal (the shell mesh is a uniform sphere, so the normal
  // is exactly radial) — avoids the faceting grid the interpolated position
  // would introduce into the analytic march.
  vec3 shellPoint = uCenterView + (uRadiusPc * uAtmoRadius) * normalize(vNormalV);
  // Everything below is in the unit-sphere frame (README.md § Shell extents).
  vec3 dir = stellata_deflattenedDir(normalize(shellPoint), uPoleView, uPolarRadiusR);
  vec3 o = stellata_deflattenedCamera(uCenterView, uRadiusPc, uPoleView, uPolarRadiusR);
  vec3 sunDir = stellata_deflattenedDir(uSunDirView, uPoleView, uPolarRadiusR);

  float t0, t1;
  if (stellata_shellEntry(o, dir, uAtmoRadius, t0, t1) <= 0.0 || t1 <= 0.0) discard;
  // Rays that strike the body ahead of the camera belong to the lit disc —
  // the mesh shader paints their airlight; the shell handles only the limb.
  if (stellata_hitsBodyAhead(o, dir)) discard;

  float tStart = max(t0, 0.0);
  vec3 inscatter;
  vec3 transmittance;
  stellata_atmosphereRadiance(
    o, dir, tStart, t1, uAtmoRadius, sunDir,
    uScaleHeightR, uScaleHeightM, uBetaRayleigh, uBetaMie, uBetaAbsorb, uMieG,
    stellata_atmoJitter(gl_FragCoord.xy),
    inscatter, transmittance);

  // Share of the chord outside the shadow, over the chord as one segment. The
  // mask cannot collapse to opacity alone: the night-limb chord is the DENSE
  // one, so it would claim the whole limb while scattering nothing.
  float s0, s1;
  stellata_shadowSpan(o, dir, sunDir, s0, s1);
  float halfChord = max(0.5 * (t1 - tStart), 1e-12);
  float litFrac = stellata_litFraction(tStart + halfChord, halfChord, s0, s1);

  // Alpha = medium opacity along the chord (1 − luminance transmittance), so
  // the premultiplied-over shell occludes the background even where it adds no
  // airlight. Both channels ride uFade for the LOD crossfade.
  float opacity = 1.0 - stellata_luma(transmittance);
  // The operator runs on the airlight radiance, before uFade premultiplies
  // it — the crossfade is a compositing weight, not part of the light the
  // operator sees. Undithered: the shell overlaps the body mesh's own
  // fragments at the limb (../../hdr/README.md § Operator).
  vec3 col = min(inscatter * uSunColour * uAirlightLuminance, vec3(STELLATA_LUMA_CEIL));
  // Premultiplied over, exactly as attachment 0 is: this is the one blend
  // whose source factor is One, so the fade has to ride the channels as
  // well as the alpha.
  float airL = dot(col, STELLATA_LUMA_WEIGHTS) * uFade;
  float a = opacity * uFade;
  outStatistic = stellataStatisticTexel(airL, a * litFrac, a);
  if (uHdrTarget < 0.5) {
    col = stellataTonemapUndithered(col, uWhitePoint, uHighlightDesat);
  }
  outColor = vec4(col * uFade, a);
  outDiffuse = stellataOccluderTexel(a);
}
