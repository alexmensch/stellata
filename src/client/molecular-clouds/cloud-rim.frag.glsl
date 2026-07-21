precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>
#include <stellata_fresnel_rim>

// Rim-shell pass on the per-cloud isosurface meshes: the Local-Bubble
// fresnel-rim treatment in realistic mode, a stippled silhouette contour
// (the SkyAtlas 2000 nebula convention) in chart mode. Vertex stage is
// the shared fresnel-shell.vert.glsl.

in vec3 vNormalView;
in vec3 vPositionView;

uniform vec3 uColour;
uniform float uAlphaLimb;
uniform float uFaceOnFloor;
uniform float uFresnelPower;
uniform float uOpacity;
uniform float uChart;
uniform vec3 uInk;
uniform float uInkAlpha;

out vec4 outColor;

const float STIPPLE_PERIOD_PX = 6.0;
// Dot radius as a fraction of the stipple period.
const float STIPPLE_DOT_RADIUS = 0.30;
// Contour band half-width in units of fwidth(n·v) — a ~constant
// pixel-width silhouette line across mesh curvature.
const float CONTOUR_WIDTH = 2.0;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vNormalView);
  vec3 viewDir = normalize(-vPositionView);

  if (uChart > 0.5) {
    float ndotv = max(dot(n, viewDir), 0.0);
    float fw = max(fwidth(ndotv), 1e-5);
    float band = 1.0 - smoothstep(CONTOUR_WIDTH * fw, 2.0 * CONTOUR_WIDTH * fw, ndotv);
    if (band <= 0.0) discard;
    vec2 cell = fract(gl_FragCoord.xy / STIPPLE_PERIOD_PX) - 0.5;
    float dotMask = 1.0 - smoothstep(STIPPLE_DOT_RADIUS - 0.08, STIPPLE_DOT_RADIUS + 0.08, length(cell));
    float a = band * dotMask * uInkAlpha;
    if (a <= 0.003) discard;
    outColor = vec4(uInk, a);
    return;
  }

  float alpha = uOpacity * fresnelRimAlpha(n, viewDir, uAlphaLimb, uFaceOnFloor, uFresnelPower);
  // ±0.5-LSB output dither — the whisper-level rim spans only a handful
  // of 8-bit levels, so quantisation bands even on a smooth mesh.
  float dith = (ign(gl_FragCoord.xy + 113.7) - 0.5) / 255.0;
  outColor = vec4(uColour, max(alpha + dith, 0.0));
}
