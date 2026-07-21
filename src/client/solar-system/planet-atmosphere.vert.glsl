precision highp float;

#include <common>

// View-space shell position — the fragment shader runs the ray/atmosphere
// geometry with the camera at the view-space origin.
out vec3 vPosV;

void main() {
  vec4 posV = modelViewMatrix * vec4(position, 1.0);
  vPosV = posV.xyz;
  gl_Position = projectionMatrix * posV;
}
