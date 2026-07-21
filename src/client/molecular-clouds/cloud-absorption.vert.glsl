precision highp float;

#include <common>
#include <logdepthbuf_pars_vertex>

// Three.js auto-injects: position (vec3), normal (vec3), modelMatrix,
// modelViewMatrix, projectionMatrix, normalMatrix, cameraPosition. Don't
// redeclare them or the WebGL2 compile will reject the duplicate symbols.

uniform vec3 uAxes;     // semi-axes in pc, descending
uniform mat3 uInvQuat;  // renderer frame → cloud-local frame rotation

// Unit-sphere frame: the cloud envelope is |p| = 1. `position` is already
// in this frame (unit sphere scaled by the mesh matrix); the camera is
// rotated into cloud-local pc and divided by the semi-axes.
out vec3 vPosUnit;
out vec3 vCamUnit;

void main() {
  vPosUnit = position;
  vec3 meshWorld = modelMatrix[3].xyz;
  vCamUnit = (uInvQuat * (cameraPosition - meshWorld)) / uAxes;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  #include <logdepthbuf_vertex>
}
