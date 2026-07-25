precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

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

  gl_FragDepth = gl_FragCoord.z;
  #include <logdepthbuf_fragment>

  outColor = vec4(uColour, vAlpha * mask);
}
