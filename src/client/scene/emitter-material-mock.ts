// Test double for the material seam, shared by the layer suites.
// See README.md § The material seam.

import * as THREE from 'three';
import type { EmitterMaterial } from './emitter-material';

/** A surface that answers every slot name — see README.md § Files. */
export function fakeEmitterMaterial(
  material: THREE.Material = new THREE.MeshBasicMaterial(),
): EmitterMaterial & { disposed: boolean } {
  const slots: Record<string, THREE.IUniform> = {};
  const uniforms = new Proxy(slots, {
    get(target, key: string) {
      target[key] ??= { value: undefined };
      return target[key];
    },
    has: () => true,
  });
  const handle = {
    material,
    uniforms,
    disposed: false,
    dispose() {
      handle.disposed = true;
      material.dispose();
    },
  };
  return handle;
}
