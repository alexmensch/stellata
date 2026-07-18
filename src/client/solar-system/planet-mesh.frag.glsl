precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

// uMap is always bound (1×1 white placeholder when the body has no
// texture) — sampling an unbound texture is undefined in WebGL.
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uColour;
// Planet → host-star direction in VIEW space; per-fragment Lambert
// against it is what produces the day/night terminator.
uniform vec3 uSunDirView;
uniform float uFade;

in vec3 vNormalV;
in vec3 vPosV;
in vec2 vUvM;

out vec4 outColor;

// Limb darkening: full brightness face-on, dimming toward the
// silhouette. Carries the whole visual character of texture-less
// bodies (Uranus) and reads subtly on textured ones.
const float LIMB_FLOOR = 0.45;
const float LIMB_EXP = 0.5;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(-vPosV);
  float dayside = max(dot(n, uSunDirView), 0.0);
  float ndotv = clamp(dot(n, v), 0.0, 1.0);
  float limb = mix(LIMB_FLOOR, 1.0, pow(ndotv, LIMB_EXP));
  vec3 base = mix(uColour, texture(uMap, vUvM).rgb, uHasMap);
  outColor = vec4(base * dayside * limb, uFade);
}
