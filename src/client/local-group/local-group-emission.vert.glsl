precision highp float;

#include <common>
#include <logdepthbuf_pars_vertex>

// Instanced volumetric proxies for Local Group emission. Each instance
// is a unit sphere scaled to the object's emission envelope (parsecs)
// and rotated into ICRS by its quaternion; the camera is transformed
// into each instance's unit-ball frame here and handed to the fragment
// raymarch as a flat varying. Compiled twice: the disc-family material
// defines FAMILY_DISC, the Sérsic-spheroid material doesn't.

uniform vec3 uWorldOffset;

in vec3 aCenterAbs;
in vec4 aQuat;
in vec3 aAxes;
in vec3 aColor;
#ifdef FAMILY_DISC
in vec3 aDisc;      // (density0, 1/R_d, 1/z_d)
in vec4 aBulge;     // (density0, 1/n, bn, pn); density0 == 0 → no bulge
in vec2 aBulgeExt;  // (1/R_e, uMax)
#else
in vec4 aSersic;    // (density0, 1/n, bn, pn)
in float aUMax;     // mesh radius in units of R_e
#endif

out vec3 vMeshLocalPos;
out vec3 vWorldPos;
flat out vec3 vCamLocal;
flat out vec3 vAxes;
flat out vec3 vColor;
#ifdef FAMILY_DISC
flat out vec3 vDisc;
flat out vec4 vBulge;
flat out vec2 vBulgeExt;
#else
flat out vec4 vSersic;
flat out float vUMax;
#endif

vec3 quatRotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  // Absolute-ICRS centre → renderer-local. f32 cancellation here leaves
  // ~0.25 pc error at the 2 Mpc envelope — invisible at galaxy scale.
  vec3 centerLocal = aCenterAbs - uWorldOffset;
  vec3 world = centerLocal + quatRotate(aQuat, position * aAxes);
  vMeshLocalPos = position;
  vWorldPos = world;
  vCamLocal = quatRotate(vec4(-aQuat.xyz, aQuat.w), cameraPosition - centerLocal) / aAxes;
  vAxes = aAxes;
  vColor = aColor;
#ifdef FAMILY_DISC
  vDisc = aDisc;
  vBulge = aBulge;
  vBulgeExt = aBulgeExt;
#else
  vSersic = aSersic;
  vUMax = aUMax;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
