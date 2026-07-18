precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

in vec3 vNormalView;
in vec3 vPositionView;

// Outer face (looking at the wall from outside the cavity) and inner face
// (the common case — the camera sits inside the bubble at Sol). Distinct
// tints so the shell's 3D orientation reads on a DoubleSide mesh.
uniform vec3 uOuterColour;
uniform vec3 uInnerColour;
uniform float uAlphaLimb;    // alpha at the silhouette
uniform float uFaceOnFloor;  // face-on alpha multiplier (0 = pure rim)
uniform float uFresnelPower;

out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>

  // Orient the normal toward the camera regardless of winding so Fresnel
  // is symmetric on both faces of the DoubleSide shell.
  vec3 n = normalize(vNormalView);
  if (!gl_FrontFacing) n = -n;
  vec3 viewDir = normalize(-vPositionView);
  float ndotv = max(dot(n, viewDir), 0.0);
  float fresnel = pow(1.0 - ndotv, uFresnelPower);
  float alpha = uAlphaLimb * mix(uFaceOnFloor, 1.0, fresnel);

  vec3 colour = gl_FrontFacing ? uOuterColour : uInnerColour;
  outColor = vec4(colour, alpha);
}
