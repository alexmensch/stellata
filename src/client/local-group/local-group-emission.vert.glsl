precision highp float;

#include <common>
#include <logdepthbuf_pars_vertex>
#include <stellata_hdr_emission>

// Instanced volumetric proxies for Local Group emission. Each instance
// is a unit sphere scaled to the component's emission envelope
// (parsecs) and rotated into ICRS by its quaternion; the camera is
// transformed into each instance's unit-ball frame here and handed to
// the fragment raymarch as a flat varying. Compiled twice: the
// disc-family material defines FAMILY_DISC, the Sérsic-spheroid
// material doesn't.

uniform vec3 uWorldOffset;
uniform float uOmegaPxArcsec2;

// Resolution floor, CSS px — mirrors MIN_PROJECTED_RADIUS_PX.
const float MIN_PROJECTED_RADIUS_PX = 1.0;

in vec3 aCenterAbs;
in vec4 aQuat;
in vec3 aAxes;
in vec3 aColor;
#ifdef FAMILY_DISC
in vec3 aDisc;      // (density0, 1/R_d, 1/z_d)
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

  // Sub-pixel proxies expand to the resolution floor: axes × k, scale
  // lengths × k, density0 ÷ k³ leaves flux exact and the profile shape
  // identical (see local-group-emission-pure.ts subPixelExpansion).
  // Sized off the LARGEST semi-axis, not the orientation-dependent
  // projected one: over-expanding a mesh the viewer can already resolve
  // would move a visible silhouette, and every object near the floor is
  // near-isotropic on screen anyway.
  float pxPerRadian = stellataPxPerRadian(uOmegaPxArcsec2);
  float meshRadiusPc = max(max(aAxes.x, aAxes.y), aAxes.z);
  float distPc = max(length(cameraPosition - centerLocal), 1e-6);
  float meshRadiusPx = (meshRadiusPc / distPc) * pxPerRadian;
  float k = max(1.0, MIN_PROJECTED_RADIUS_PX / max(meshRadiusPx, 1e-12));
  float densityScale = 1.0 / (k * k * k);
  vec3 axes = aAxes * k;

  vec3 world = centerLocal + quatRotate(aQuat, position * axes);
  vMeshLocalPos = position;
  vWorldPos = world;
  vCamLocal = quatRotate(vec4(-aQuat.xyz, aQuat.w), cameraPosition - centerLocal) / axes;
  vAxes = axes;
  vColor = aColor;
#ifdef FAMILY_DISC
  // (density0, 1/R_d, 1/z_d) — the reciprocals scale by 1/k.
  vDisc = vec3(aDisc.x * densityScale, aDisc.yz / k);
#else
  // uMax is in R_e units and R_e = axes/uMax, so it rides the expansion
  // untouched; only the normalisation moves.
  vSersic = vec4(aSersic.x * densityScale, aSersic.yzw);
  vUMax = aUMax;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
