precision highp float;

#include <common>
#include <logdepthbuf_pars_vertex>

// Per-vertex (quad corner): xy in [-0.5, 0.5].
in vec2 aCorner;

// Per-instance:
//   iLocalPos — probe position in the renderer's local frame.
//   iAlpha    — marker opacity; 0 collapses the quad (pre-launch,
//               distance-culled, or no trajectory for this slot).
in vec3 iLocalPos;
in float iAlpha;

uniform vec2 uViewport;       // CSS pixels
uniform float uPixelRatio;
uniform float uSizePx;

out vec2 vUv;
out float vAlpha;

void main() {
  vec4 probeView = modelViewMatrix * vec4(iLocalPos, 1.0);
  if (iAlpha <= 0.0 || probeView.z >= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = aCorner;
    vAlpha = 0.0;
    return;
  }
  vUv = aCorner;
  vAlpha = iAlpha;

  // Fixed pixel size at any range: a metre-scale probe has no meaningful
  // angular diameter or reflected magnitude, so the marker is chrome —
  // project the centre and expand the corners in screen space.
  vec4 centreClip = projectionMatrix * vec4(probeView.xyz, 1.0);
  vec2 pixelOffset = aCorner * uSizePx * uPixelRatio;
  vec2 ndcOffset = pixelOffset / (uViewport * uPixelRatio) * 2.0;
  gl_Position = centreClip + vec4(ndcOffset * centreClip.w, 0.0, 0.0);

  #include <logdepthbuf_vertex>
}
