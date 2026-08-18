// three/TSL half of vec4 attribute packing: geometry attributes from a
// pack plan, and the per-scalar accessor node. README.md § Attribute
// packing.

import { InstancedBufferAttribute } from 'three';
import type { Node } from 'three/webgpu';
import { attrVec4 } from './tsl-shim';
import { packVec4Buffers, type Vec4PackPlan } from './attribute-packing-pure';

const COMPONENT = ['x', 'y', 'z', 'w'] as const;

export function packedBufferName(buffer: number, prefix = 'iPack'): string {
  return `${prefix}${buffer}`;
}

/** One InstancedBufferAttribute per plan buffer, ready for
 *  geometry.setAttribute(name, attribute). */
export function buildPackedAttributes(
  plan: Vec4PackPlan,
  sources: Readonly<Record<string, ArrayLike<number>>>,
  count: number,
  prefix = 'iPack',
): { name: string; attribute: InstancedBufferAttribute }[] {
  return packVec4Buffers(plan, sources, count).map((buffer, i) => ({
    name: packedBufferName(i, prefix),
    attribute: new InstancedBufferAttribute(buffer, 4),
  }));
}

/** The scalar's accessor node — the packed replacement for
 *  attribute('iScalarName'). */
export function packedScalar(
  plan: Vec4PackPlan,
  name: string,
  prefix = 'iPack',
): Node<'float'> {
  const slot = plan.slots[name];
  if (slot === undefined) throw new Error(`not in the pack plan: ${name}`);
  return attrVec4(packedBufferName(slot.buffer, prefix))[COMPONENT[slot.component]];
}
