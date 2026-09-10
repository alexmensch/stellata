precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>
#include <stellata_fresnel_rim>

in vec3 vNormalView;
in vec3 vPositionView;

uniform vec3 uColour;
uniform float uAlphaLimb;
uniform float uFaceOnFloor;
uniform float uFresnelPower;
uniform float uNearFadePc;
uniform float uDepthDimRefPc;
uniform float uDepthPower;

out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vNormalView);
  vec3 viewDir = normalize(-vPositionView);
  float alpha = fresnelRimAlpha(n, viewDir, uAlphaLimb, uFaceOnFloor, uFresnelPower)
    * shellDistanceAttenuation(vPositionView, uNearFadePc, uDepthDimRefPc, uDepthPower);

  outColor = vec4(uColour, alpha);
}
