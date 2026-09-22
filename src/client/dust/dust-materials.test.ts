import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslDustParticleMaterials } from '../webgpu/dust/tsl-dust-materials';
import type { DustParticleSharedUniforms } from './dust-particle-layer';

const hdr = makeHdrEmitterUniforms();

function sharedNodes() {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return buildSharedUniformNodes(shared).nodes;
}

describe('the dust-particle material seam', () => {
  const shared: DustParticleSharedUniforms = {
    uPixelRatio: { value: 1 },
    uViewport: { value: new THREE.Vector2(800, 600) },
    uWorldOffset: { value: new THREE.Vector3() },
    uDustEnabled: { value: 0 },
    uDustDensityMin: { value: 1e-4 },
    uDustLogRatio: { value: 4 },
  };

  // See ../webgpu/dust/README.md § Six of its seven uniforms.
  it('exposes uParticleStrength as the only layer-owned slot', () => {
    const tslSlots = makeTslDustParticleMaterials({
      nodes: sharedNodes(), registerMrtLayer: () => () => {},
    }).dustParticles(shared).uniforms;
    expect(tslSlots.uParticleStrength.value).toBe(0);
    expect(Object.keys(tslSlots)).toEqual(['uParticleStrength']);
  });

  it('severs the MRT registration on dispose', () => {
    let live = 0;
    const surface = makeTslDustParticleMaterials({
      nodes: sharedNodes(),
      registerMrtLayer: () => {
        live++;
        return () => { live--; };
      },
    }).dustParticles(shared);
    expect(live).toBe(1);
    surface.dispose();
    expect(live).toBe(0);
  });
});
