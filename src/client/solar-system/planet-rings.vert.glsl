precision highp float;

#include <common>
#include <logdepthbuf_pars_vertex>

out vec2 vLocalXY;

void main() {
  vLocalXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
