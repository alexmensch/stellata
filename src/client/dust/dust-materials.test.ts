import { describe, expect, it } from 'vitest';
import { makeHdrEmitterUniforms } from '../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslDustParticleMaterials } from '../webgpu/dust/tsl-dust-materials';

const hdr = makeHdrEmitterUniforms();

function sharedNodes() {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return buildSharedUniformNodes(shared).nodes;
}

describe('the dust-particle material seam', () => {
  // See ../webgpu/dust/README.md § Six of its seven uniforms.
  it('exposes uParticleStrength as the only layer-owned slot', () => {
    const tslSlots = makeTslDustParticleMaterials({
      nodes: sharedNodes(), registerMrtLayer: () => () => {},
    }).dustParticles().uniforms;
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
    }).dustParticles();
    expect(live).toBe(1);
    surface.dispose();
    expect(live).toBe(0);
  });
});
