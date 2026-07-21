precision highp float;

#include <common>
#include <stellata_atmosphere_scatter>

// Planet centre + radii in view space (rigid, so pc lengths are preserved).
uniform vec3 uCenterView;
uniform float uRadiusPc;
// Atmosphere top radius in planet-radius units (1 + heightKm/radiusKm).
uniform float uAtmoRadius;
// Body → host direction, unit, view space.
uniform vec3 uSunDirView;
// Scale heights (planet-radius units) + per-channel coefficients.
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uBetaRayleigh;
uniform float uBetaMie;
uniform vec3 uBetaAbsorb;
uniform float uMieG;
// Sun colour × intensity, and the host-distance display exposure.
uniform vec3 uSunColour;
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

  float b = dot(o, dir);
  float discA = b * b - (dot(o, o) - uAtmoRadius * uAtmoRadius);
  if (discA <= 0.0) discard;
  float rootA = sqrt(discA);
  float t0 = -b - rootA;
  float t1 = -b + rootA;
  if (t1 <= 0.0) discard;

  // Rays that strike the body ahead of the camera belong to the lit disc —
  // the mesh shader paints their airlight; the shell handles only the limb.
  float discP = b * b - (dot(o, o) - 1.0);
  if (discP > 0.0 && -b - sqrt(discP) > 0.0) discard;

  vec3 inscatter;
  vec3 transmittance;
  stellata_atmosphereRadiance(
    o, dir, max(t0, 0.0), t1, uAtmoRadius, uSunDirView,
    uScaleHeightR, uScaleHeightM, uBetaRayleigh, uBetaMie, uBetaAbsorb, uMieG,
    stellata_atmoJitter(gl_FragCoord.xy),
    inscatter, transmittance);

  outColor = vec4(inscatter * uSunColour * uLitIntensity * uFade, 1.0);
}
