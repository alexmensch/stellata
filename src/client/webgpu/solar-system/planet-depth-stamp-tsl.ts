// The planet depth pre-stamp in TSL: depth-only over the body spheroid,
// colour writes off, three's own vertex stage. See README.md.

import { vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';

/**
 * Colour writes are off, so every output is discarded by the write mask —
 * yet the material still takes the single↔struct swap, for three's
 * pipeline cache rather than for validity (the star core mask carries the
 * same argument: `../star/star-core-mask-tsl.ts`).
 */
export function buildPlanetDepthStampMaterial(): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'planet-depth-stamp-tsl';
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;
  return finishMrtMaterial(material, () => ({
    colour: vec4(0.0), statistic: vec4(0.0), diffuse: vec4(0.0),
  }));
}
