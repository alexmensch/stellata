precision highp float;

#include <common>
#ifndef LOCAL_DEPTH_PASS
#include <logdepthbuf_pars_fragment>
#endif

in vec2 vUv;
in float vAlpha;

uniform vec3 uColour;
uniform float uSizePx;

out vec4 outColor;

void main() {
  // Diamond glyph: a rotated square reads as a spacecraft marker rather
  // than one more star point, and stays legible at the few-pixel size the
  // vertex shader pins. Edge antialiased over one pixel of the quad.
  float d = abs(vUv.x) + abs(vUv.y);
  float aa = 1.0 / max(uSizePx, 1.0);
  float mask = 1.0 - smoothstep(0.5 - aa, 0.5, d);
  if (mask <= 0.0 || vAlpha <= 0.0) discard;

  #ifndef LOCAL_DEPTH_PASS
  #include <logdepthbuf_fragment>
  #endif

  outColor = vec4(uColour, vAlpha * mask);
}
