precision highp float;

#include <common>

// View-space position + smooth normal. The fragment shader reconstructs the
// ray direction from the RENORMALIZED normal (a smooth sphere direction)
// rather than the faceted interpolated position, so the analytic march
// doesn't read the mesh tessellation as a grid.
out vec3 vPosV;
out vec3 vNormalV;

void main() {
  vec4 posV = modelViewMatrix * vec4(position, 1.0);
  vPosV = posV.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * posV;
}
