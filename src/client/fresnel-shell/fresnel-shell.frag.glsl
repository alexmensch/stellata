precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

in vec3 vNormalView;
in vec3 vPositionView;

uniform vec3 uColour;
uniform float uAlphaLimb;
uniform float uFaceOnFloor;
uniform float uFresnelPower;

out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vNormalView);
  vec3 viewDir = normalize(-vPositionView);
  float ndotv = max(dot(n, viewDir), 0.0);
  float fresnel = pow(1.0 - ndotv, uFresnelPower);
  float alpha = uAlphaLimb * mix(uFaceOnFloor, 1.0, fresnel);

  outColor = vec4(uColour, alpha);
}
