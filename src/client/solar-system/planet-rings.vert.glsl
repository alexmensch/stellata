precision highp float;

#include <common>

out vec2 vLocalXY;

void main() {
  vLocalXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
