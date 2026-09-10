// Rim-alpha shape plus camera-distance attenuation, shared by the boundary
// shells (fresnel-shell.frag.glsl) and the molecular-cloud rim pass.
// See README.md.

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

// A second factor on the same alpha, deliberately not folded into the
// shape above: view space puts the camera at the origin, so the fragment's
// own camera distance is length(positionView) with no extra varying.
// Mirrored by shell-distance-pure.ts and by the TSL twin.
float shellDistanceAttenuation(
  vec3 positionView,
  float nearFadePc,
  float depthDimRefPc,
  float depthPower
) {
  float dView = length(positionView);
  float nearFade = clamp(dView / nearFadePc, 0.0, 1.0);
  float depthDim = pow(clamp(depthDimRefPc / dView, 0.0, 1.0), depthPower);
  return nearFade * depthDim;
}
