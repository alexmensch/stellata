// The `IUniform` face a ported layer writes, over a record of TSL nodes.
// See README.md § Uniform slots.

import type { IUniform } from 'three';
import type { uniformArray } from 'three/tsl';

/** A uniform-array node behind an `IUniform` face: the layer mutates the
 *  Vector4s in place, and the node re-packs the buffer every render. */
function arraySlot(node: ReturnType<typeof uniformArray>): IUniform {
  return { get value() { return node.array; } };
}

/** The node record behind the `IUniform` face the layers write. Every node
 *  but a uniform array already carries `.value`; that one needs the
 *  adapter above. */
export function uniformSlotsOf(nodes: Record<string, unknown>): Record<string, IUniform> {
  const slots: Record<string, IUniform> = {};
  for (const [key, node] of Object.entries(nodes)) {
    slots[key] = (node as { isArrayBufferNode?: boolean }).isArrayBufferNode === true
      ? arraySlot(node as ReturnType<typeof uniformArray>)
      : (node as IUniform);
  }
  return slots;
}
