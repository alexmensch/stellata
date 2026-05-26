// Canonical uniform shape for the perceptual-disc.glsl chunk. See
// star-pipeline/README.md § Star intensity profile for the chunk's
// role and src/client/solar-system/README.md § Planet rendering.

import * as THREE from 'three';

/**
 * Uniforms the shared `perceptual-disc.glsl` chunk reads. The star
 * pipeline's `sharedUniforms` map (initialised in `stellata.ts`)
 * `satisfies` this shape, and the planet pipeline picks exactly these
 * keys out at material-build time via `pickPerceptualDiscUniforms`.
 *
 * Adding a uniform to the chunk means extending this interface AND
 * `PERCEPTUAL_DISC_UNIFORM_KEYS` below — the picker's tuple is the
 * runtime side of the same list.
 */
export interface PerceptualDiscUniforms {
  uMaxAppMag: { value: number };
  uSizeMin: { value: number };
  uSizeMax: { value: number };
  uSizeSpan: { value: number };
  uSizeKnee: { value: number };
  uVisibleThreshold: { value: number };
  uVisibleK: { value: number };
  uCoreThreshold: { value: number };
  uDiscardThreshold: { value: number };
  uDistNMin: { value: number };
  uDistNMax: { value: number };
  uLumBiasMin: { value: number };
  uLumBiasMax: { value: number };
  uViewport: { value: THREE.Vector2 };
  uPixelRatio: { value: number };
  uFovYRad: { value: number };
}

export const PERCEPTUAL_DISC_UNIFORM_KEYS = [
  'uMaxAppMag',
  'uSizeMin',
  'uSizeMax',
  'uSizeSpan',
  'uSizeKnee',
  'uVisibleThreshold',
  'uVisibleK',
  'uCoreThreshold',
  'uDiscardThreshold',
  'uDistNMin',
  'uDistNMax',
  'uLumBiasMin',
  'uLumBiasMax',
  'uViewport',
  'uPixelRatio',
  'uFovYRad',
] as const satisfies readonly (keyof PerceptualDiscUniforms)[];

/**
 * Pick exactly the perceptual-disc keys out of a wider shared-uniforms
 * object, preserving each `{ value }` slot's identity so writes from
 * the star side propagate to the planet materials without bookkeeping.
 * Used by `PlanetBodyField.buildMaterials` to construct the chunk's
 * input map without re-declaring every key.
 */
export function pickPerceptualDiscUniforms<T extends PerceptualDiscUniforms>(
  src: T,
): PerceptualDiscUniforms {
  const out: Record<string, THREE.IUniform> = {};
  for (const key of PERCEPTUAL_DISC_UNIFORM_KEYS) {
    out[key] = src[key];
  }
  return out as unknown as PerceptualDiscUniforms;
}
