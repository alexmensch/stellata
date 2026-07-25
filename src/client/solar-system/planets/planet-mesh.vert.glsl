precision highp float;

#include <common>

out vec3 vNormalV;
out vec3 vPosV;
out vec2 vUvM;

void main() {
  vUvM = uv;
  // normalMatrix is the inverse-transpose of modelView, so normals
  // stay correct under the oblate (non-uniform) mesh scale.
  vNormalV = normalize(normalMatrix * normal);
  vec4 posV = modelViewMatrix * vec4(position, 1.0);
  vPosV = posV.xyz;
  gl_Position = projectionMatrix * posV;
}
