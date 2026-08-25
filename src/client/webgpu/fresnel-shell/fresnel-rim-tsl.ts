// TSL mirror of the stellata_fresnel_rim chunk: alpha peaks at the
// silhouette, floors to a dim value face-on. Shared with the cloud rim
// shells exactly as the GLSL chunk is.

import { Fn, float, max, mix, pow } from 'three/tsl';
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
