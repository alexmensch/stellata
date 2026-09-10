// TSL mirror of the stellata_fresnel_rim chunk: the rim-alpha shape and
// the camera-distance attenuation on it. Shared with the cloud rim shells
// exactly as the GLSL chunk is.

import { Fn, clamp, float, length, max, mix, pow } from 'three/tsl';
import type { Node } from 'three/webgpu';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

export const fresnelRimAlphaTsl = /* @__PURE__ */ Fn((
  [n, viewDir, alphaLimb, faceOnFloor, fresnelPower]: [N3, N3, NF, NF, NF],
) => {
  const ndotv = max(n.dot(viewDir), 0.0);
  const fresnel = pow(float(1.0).sub(ndotv), fresnelPower);
  return alphaLimb.mul(mix(faceOnFloor, float(1.0), fresnel));
});

/** A second factor on the same alpha, kept out of the shape above exactly
 *  as in the GLSL: `positionView` is a built-in here, so the fragment's own
 *  camera distance costs nothing. Mirrored by
 *  `../../fresnel-shell/shell-distance-pure.ts`. */
export const shellDistanceAttenuationTsl = /* @__PURE__ */ Fn((
  [positionViewNode, nearFadePc, depthDimRefPc, depthPower]: [N3, NF, NF, NF],
) => {
  const dView = length(positionViewNode);
  const nearFade = clamp(dView.div(nearFadePc), 0.0, 1.0);
  const depthDim = pow(clamp(depthDimRefPc.div(dView), 0.0, 1.0), depthPower);
  return nearFade.mul(depthDim);
});
