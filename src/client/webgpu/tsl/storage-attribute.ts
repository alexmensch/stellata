// Storage buffer attributes no geometry owns: releasing one, and the device
// limit deciding whether a vertex stage may read one at all.
// README.md § Storage attributes.

import type { BufferAttribute } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

interface AttributeRegistry {
  delete(attribute: BufferAttribute): unknown;
}

/** The slice of the backend the limit read needs, structurally — the project
 *  pulls in no WebGPU type package (`../timestamps/timestamp-probe.ts` takes
 *  the same route). */
interface LimitedBackend {
  device?: { limits?: { maxStorageBuffersInVertexStage?: number } } | null;
}

/**
 * three r185 frees a GPU buffer only when the geometry holding its
 * attribute is disposed; an attribute bound through `storage()` alone has
 * no public release, so this walks the same private registry
 * `Geometries` does. Idempotent, and a no-op on a renderer that has not
 * initialised (the registry exists only after `init()`).
 */
export function disposeStorageAttribute(
  renderer: WebGPURenderer,
  attribute: BufferAttribute,
): void {
  const registry = (renderer as unknown as { _attributes?: AttributeRegistry | null })._attributes;
  registry?.delete(attribute);
}

/**
 * Whether a vertex stage on this device may read a storage buffer at all.
 * Zero is what WebGPU's compatibility feature level reports, and three
 * requests that level unconditionally, so a device can arrive holding none.
 * A device reporting no limit predates the compatibility level entirely —
 * core limits apply there and the answer is yes.
 */
export function supportsVertexStageStorageBuffers(renderer: WebGPURenderer): boolean {
  const limit = (renderer.backend as unknown as LimitedBackend)
    .device?.limits?.maxStorageBuffersInVertexStage;
  return limit === undefined || limit > 0;
}
