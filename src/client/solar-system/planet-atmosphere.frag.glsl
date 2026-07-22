precision highp float;

#include <common>
#include <stellata_atmosphere_uniforms>
#include <stellata_atmosphere_scatter>

// Body → host direction (unit, view space); sun colour × intensity display
// exposure; and the LOD crossfade weight — not part of the shared scatter
// contract (the mesh shader uses these outside its atmosphere block too).
uniform vec3 uSunDirView;
uniform float uLitIntensity;
uniform float uFade;

in vec3 vPosV;
in vec3 vNormalV;

out vec4 outColor;

void main() {
  // Reconstruct the shell-surface point on the SMOOTH sphere from the
  // renormalized normal (the shell mesh is a uniform sphere, so the normal
  // is exactly radial) — avoids the faceting grid the interpolated position
  // would introduce into the analytic march.
  vec3 shellPoint = uCenterView + (uRadiusPc * uAtmoRadius) * normalize(vNormalV);
  vec3 dir = normalize(shellPoint);
  // Camera (origin) relative to the planet centre, planet-radius units.
  vec3 o = -uCenterView / uRadiusPc;

  float t0, t1;
  if (stellata_shellEntry(o, dir, uAtmoRadius, t0, t1) <= 0.0 || t1 <= 0.0) discard;
  // Rays that strike the body ahead of the camera belong to the lit disc —
  // the mesh shader paints their airlight; the shell handles only the limb.
  if (stellata_hitsBodyAhead(o, dir)) discard;

  vec3 inscatter;
  vec3 transmittance;
  stellata_atmosphereRadiance(
    o, dir, max(t0, 0.0), t1, uAtmoRadius, uSunDirView,
    uScaleHeightR, uScaleHeightM, uBetaRayleigh, uBetaMie, uBetaAbsorb, uMieG,
    stellata_atmoJitter(gl_FragCoord.xy),
    inscatter, transmittance);

  // Alpha = medium opacity along the chord (1 − luminance transmittance), so
  // the premultiplied-over shell occludes the background even where it adds no
  // airlight. Both channels ride uFade for the LOD crossfade.
  float opacity = 1.0 - stellata_luma(transmittance);
  outColor = vec4(inscatter * uSunColour * uLitIntensity * uFade, opacity * uFade);
}
