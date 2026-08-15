precision highp float;

#include <common>
#include <stellata_hdr_emission>
#include <stellata_tonemap>

// HDR seam, bound by reference from HdrPipeline.emitterUniforms.
uniform float uHdrTarget;      // 1 = target bound, emit linear L untouched
uniform float uWhitePoint;
uniform float uHighlightDesat;

// 1-D radial ring profile: RGB = ring colour, A = opacity. U spans
// the annulus inner→outer edge.
uniform sampler2D uRingMap;
// Inner edge as a fraction of the outer radius (geometry is a unit-
// outer-radius annulus, scaled to uOuterPc on the mesh).
uniform float uInnerRatio;
uniform float uOuterPc;
// Body equatorial/polar radii (pc) — the shadow ellipsoid.
uniform float uEqRadiusPc;
uniform float uPolarRadiusPc;
// Ring-local frame (+z = pole): planet→host unit direction, and the
// camera position relative to the planet centre.
uniform vec3 uSunDirLocal;
uniform vec3 uCamPosLocal;
uniform float uFade;
// Host irradiance in the scene-wide HDR unit — the same scalar the body
// mesh's airlight rides (mesh-surface-pure.ts hostIrradianceLuminance), so
// ring↔body contrast is fixed by the shared exposure rather than matched.
uniform float uAirlightLuminance;

in vec2 vLocalXY;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outStatistic;
// Attachment 2 holds the diffuse emitters until the resolve convolves them,
// and the annulus is drawn in front of them
// (../../../hdr/attachments/README.md § The gate).
layout(location = 2) out vec4 outDiffuse;

// Unlit-face factor: light transmitted through the ring plane instead
// of reflected off it.
const float TRANSMIT = 0.35;
// Residual brightness inside the planet's shadow.
const float SHADOW_FLOOR = 0.05;
// Lambertian reflectance → radiance. The strip's RGB is read as a LINEAR
// particle reflectance, not display-encoded imagery: it was authored as an
// albedo proxy anchored to the ~0.05 particle albedo
// (data/textures/README.md § Ring strips), so decoding it as sRGB would
// darken the rings ~5x against the true-opacity alpha it was built with.
const float INV_PI = 0.3183098861837907;

// Ray–ellipsoid roots for `o + t·d` against the body spheroid: scale
// space so it becomes a unit sphere, solve the quadratic. Returns
// (t0, t1) with t0 ≤ t1. A miss returns (-1e30, -1e30) — negative so
// it fails the shadow test (t1 > 0).
vec2 bodyRoots(vec3 o, vec3 d) {
  vec3 os = vec3(o.xy / uEqRadiusPc, o.z / uPolarRadiusPc);
  vec3 ds = vec3(d.xy / uEqRadiusPc, d.z / uPolarRadiusPc);
  float a = dot(ds, ds);
  float b = 2.0 * dot(os, ds);
  float c = dot(os, os) - 1.0;
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0) return vec2(-1e30);
  float s = sqrt(disc);
  return vec2((-b - s) / (2.0 * a), (-b + s) / (2.0 * a));
}

void main() {
  vec3 frag = vec3(vLocalXY * uOuterPc, 0.0);

  float r = length(vLocalXY);
  float u = clamp((r - uInnerRatio) / (1.0 - uInnerRatio), 0.0, 1.0);
  vec4 strip = texture(uRingMap, vec2(u, 0.5));

  // Reflected on the sunlit face, dimmer transmitted light on the
  // far face; both die off as illumination goes edge-on to the plane.
  float sameSide = step(0.0, uSunDirLocal.z * uCamPosLocal.z);
  float light = mix(TRANSMIT, 1.0, sameSide)
    * smoothstep(0.0, 0.02, abs(uSunDirLocal.z));

  // In the body's shadow when the ray toward the sun hits it.
  if (bodyRoots(frag, uSunDirLocal).y > 0.0) light *= SHADOW_FLOOR;

  vec3 col = min(
      strip.rgb * light * uAirlightLuminance * INV_PI, vec3(STELLATA_LUMA_CEIL));
  float ringL = dot(col, STELLATA_LUMA_WEIGHTS);
  outStatistic = stellataStatisticTexel(ringL, 1.0, strip.a * uFade);
  // Undithered — the annulus alpha-blends over the body mesh, so a pixel
  // can take both fragments (../../../hdr/README.md § Operator).
  if (uHdrTarget < 0.5) {
    col = stellataTonemapUndithered(col, uWhitePoint, uHighlightDesat);
  }
  outColor = vec4(col, strip.a * uFade);
  outDiffuse = stellataOccluderTexel(strip.a * uFade);
}
