// Release of a storage buffer attribute that no geometry owns.
// README.md § Storage attributes.

import type { BufferAttribute } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

interface AttributeRegistry {
  delete(attribute: BufferAttribute): unknown;
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
