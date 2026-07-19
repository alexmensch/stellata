precision highp float;

#include <common>
#ifndef LOCAL_DEPTH_PASS
#include <logdepthbuf_pars_vertex>
#endif

out vec2 vLocalXY;

void main() {
  vLocalXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #ifndef LOCAL_DEPTH_PASS
  #include <logdepthbuf_vertex>
  #endif
}
