// three/TSL half of vec4 attribute packing: geometry attributes from a
// pack plan, and the per-scalar accessor node. README.md § Attribute
// packing.

import { InstancedBufferAttribute } from 'three';
import type { Node } from 'three/webgpu';
import { attrVec4 } from './tsl-shim';
import {
  packVec4Buffers,
  packedAccess,
  packedBufferName,
  type Vec4PackPlan,
} from './attribute-packing-pure';

/** One InstancedBufferAttribute per plan buffer, ready for
 *  geometry.setAttribute(name, attribute). */
export function buildPackedAttributes(
  plan: Vec4PackPlan,
  sources: Readonly<Record<string, ArrayLike<number>>>,
  count: number,
): { name: string; attribute: InstancedBufferAttribute }[] {
  return packVec4Buffers(plan, sources, count).map((buffer, i) => ({
    name: packedBufferName(plan, i),
    attribute: new InstancedBufferAttribute(buffer, 4),
  }));
}

/** The scalar's accessor node — the packed replacement for
 *  attribute('iScalarName'). */
export function packedScalar(plan: Vec4PackPlan, name: string): Node<'float'> {
  const { buffer, component } = packedAccess(plan, name);
  return attrVec4(buffer)[component];
}
