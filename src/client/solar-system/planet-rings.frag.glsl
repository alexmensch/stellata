precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

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

in vec2 vLocalXY;

out vec4 outColor;

// Unlit-face factor: light transmitted through the ring plane instead
// of reflected off it.
const float TRANSMIT = 0.35;
// Residual brightness inside the planet's shadow.
const float SHADOW_FLOOR = 0.05;

// True when the sun ray from ring point `p` (pc, ring-local) hits the
// body ellipsoid — scale space so the spheroid becomes a unit sphere,
// then ray–sphere intersect toward the sun.
bool inPlanetShadow(vec3 p) {
  vec3 ps = vec3(p.xy / uEqRadiusPc, p.z / uPolarRadiusPc);
  vec3 ds = vec3(uSunDirLocal.xy / uEqRadiusPc, uSunDirLocal.z / uPolarRadiusPc);
  float a = dot(ds, ds);
  float b = 2.0 * dot(ps, ds);
  float c = dot(ps, ps) - 1.0;
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0) return false;
  // Nearest intersection must lie toward the sun (t > 0).
  return (-b + sqrt(disc)) > 0.0;
}

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocalXY);
  float u = clamp((r - uInnerRatio) / (1.0 - uInnerRatio), 0.0, 1.0);
  vec4 strip = texture(uRingMap, vec2(u, 0.5));

  // Reflected on the sunlit face, dimmer transmitted light on the
  // far face; both die off as illumination goes edge-on to the plane.
  float sameSide = step(0.0, uSunDirLocal.z * uCamPosLocal.z);
  float light = mix(TRANSMIT, 1.0, sameSide)
    * smoothstep(0.0, 0.02, abs(uSunDirLocal.z));

  vec3 p = vec3(vLocalXY * uOuterPc, 0.0);
  if (inPlanetShadow(p)) light *= SHADOW_FLOOR;

  outColor = vec4(strip.rgb * light, strip.a * uFade);
}
