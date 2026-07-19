precision highp float;

#include <common>

// Shell-local unit-sphere position — the fragment shader runs the
// ray/shell geometry in this frame (shell radius = 1).
out vec3 vPosL;

void main() {
  vPosL = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
