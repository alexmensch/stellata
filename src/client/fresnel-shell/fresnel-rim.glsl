// Fresnel-rim alpha shape shared by the boundary shells
// (fresnel-shell.frag.glsl) and the molecular-cloud presence pass:
// alpha peaks at the silhouette, floors to a dim value face-on.

float fresnelRimAlpha(
  vec3 n,
  vec3 viewDir,
  float alphaLimb,
  float faceOnFloor,
  float fresnelPower
) {
  float ndotv = max(dot(n, viewDir), 0.0);
  float fresnel = pow(1.0 - ndotv, fresnelPower);
  return alphaLimb * mix(faceOnFloor, 1.0, fresnel);
}
