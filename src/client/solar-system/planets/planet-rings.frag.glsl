precision highp float;

#include <common>

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
// Host-irradiance display intensity — same scalar the body mesh applies
// (perceptual-magnitude.ts hostIntensityScale), so ring↔body contrast is
// preserved as both respond together.
uniform float uLitIntensity;

in vec2 vLocalXY;

out vec4 outColor;

// Unlit-face factor: light transmitted through the ring plane instead
// of reflected off it.
const float TRANSMIT = 0.35;
// Residual brightness inside the planet's shadow.
const float SHADOW_FLOOR = 0.05;

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

  outColor = vec4(strip.rgb * light * uLitIntensity, strip.a * uFade);
}
