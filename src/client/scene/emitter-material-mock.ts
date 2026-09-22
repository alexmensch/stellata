// Test double for the material seam, shared by the layer suites.
// See README.md § The material seam.

import { expect } from 'vitest';
import * as THREE from 'three';
import type { EmitterMaterial } from './emitter-material';

export interface FakeEmitterMaterial extends EmitterMaterial {
  disposed: boolean;
  /** Every slot name the layer actually wrote or read, in first-touch
   *  order. The surface answers any name, so this is what a factory suite
   *  compares against the roster the real factory builds. */
  readonly touchedSlots: string[];
}

/** A surface that answers every slot name — see README.md § Files. */
export function fakeEmitterMaterial(
  material: THREE.Material = new THREE.MeshBasicMaterial(),
): FakeEmitterMaterial {
  const slots: Record<string, THREE.IUniform> = {};
  const uniforms = new Proxy(slots, {
    get(target, key) {
      // Symbols reach here from vitest's matchers and pretty-printer —
      // `Symbol.iterator`, `Symbol.toStringTag`. Minting a slot for one
      // answers those with an object where they expect undefined.
      if (typeof key !== 'string') return Reflect.get(target, key) as unknown;
      target[key] ??= { value: undefined };
      return target[key];
    },
    has: (target, key) => typeof key === 'string' || Reflect.has(target, key),
  });
  const handle: FakeEmitterMaterial = {
    material,
    uniforms,
    disposed: false,
    get touchedSlots() { return Object.keys(slots); },
    dispose() {
      handle.disposed = true;
      material.dispose();
    },
  };
  return handle;
}

export interface SurfaceRecorder<A extends unknown[]> {
  /** One per `mint()` call, in build order. */
  readonly surfaces: FakeEmitterMaterial[];
  mint(...args: A): FakeEmitterMaterial;
}

/** The body of every factory double: a fresh surface per call, seeded from
 *  the call's arguments the way the shipped factory seeds it, and kept. */
export function surfaceRecorder<A extends unknown[] = []>(
  seed: (surface: FakeEmitterMaterial, ...args: A) => void = () => {},
): SurfaceRecorder<A> {
  const surfaces: FakeEmitterMaterial[] = [];
  return {
    surfaces,
    mint(...args) {
      const surface = fakeEmitterMaterial();
      seed(surface, ...args);
      surfaces.push(surface);
      return surface;
    },
  };
}

/** README.md § The material seam — the `touchedSlots` guard. */
export function expectSlotsServedBy(
  touched: readonly string[],
  real: EmitterMaterial,
): void {
  expect(touched.length).toBeGreaterThan(0);
  const missing = touched.filter((name) => !(name in real.uniforms));
  expect(missing, `slots no factory serves: ${missing.join(', ')}`).toEqual([]);
}
