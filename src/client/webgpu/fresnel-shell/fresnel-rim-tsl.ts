// The rim-alpha shape and the camera-distance attenuation on it, shared by
// the boundary shells and the cloud rim shells.

import { Fn, clamp, float, max, mix, pow } from 'three/tsl';
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

/** A second factor on the same alpha, kept out of the shape above:
 *  `positionView` is a built-in here, so the fragment's own
 *  camera distance costs nothing beyond the length the caller already takes
 *  to build `viewDir`. Mirrored by
 *  `../../fresnel-shell/shell-distance-pure.ts`. */
export const shellDistanceAttenuationTsl = /* @__PURE__ */ Fn((
  [dView, nearFadePc, depthDimRefPc, depthPower]: [NF, NF, NF, NF],
) => {
  const nearFade = clamp(dView.div(nearFadePc), 0.0, 1.0);
  const depthDim = pow(clamp(depthDimRefPc.div(dView), 0.0, 1.0), depthPower);
  return nearFade.mul(depthDim);
});
