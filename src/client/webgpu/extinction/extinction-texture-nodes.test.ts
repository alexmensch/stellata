import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { ExtinctionTextureNodes } from './extinction-texture-nodes';

describe('ExtinctionTextureNodes', () => {
  it('binds both slots to a placeholder before anything attaches', () => {
    const nodes = new ExtinctionTextureNodes();
    expect(nodes.dust.value).not.toBeNull();
    expect(nodes.avPrepass.value).not.toBeNull();
  });

  // A swap to a differently-typed texture rebuilds the pipeline instead of
  // rebinding, which is why the placeholders come from the volume's own
  // factory and match the prepass target's format.
  it('gives each placeholder its target format and type', () => {
    const nodes = new ExtinctionTextureNodes();
    const real = createVoxelTexture(4, new Uint8Array(64));
    expect(nodes.dust.value.format).toBe(real.format);
    expect(nodes.dust.value.type).toBe(real.type);
    expect(nodes.avPrepass.value.format).toBe(THREE.RedFormat);
    expect(nodes.avPrepass.value.type).toBe(THREE.FloatType);
    real.dispose();
    nodes.dispose();
  });

  it('swaps each slot in and back out to its own placeholder', () => {
    const nodes = new ExtinctionTextureNodes();
    const dustPlaceholder = nodes.dust.value;
    const avPlaceholder = nodes.avPrepass.value;
    const volume = createVoxelTexture(4, new Uint8Array(64));
    const av = new THREE.DataTexture(new Float32Array(4), 2, 2);

    nodes.setDustTexture(volume);
    nodes.setAvPrepassTexture(av);
    expect(nodes.dust.value).toBe(volume);
    expect(nodes.avPrepass.value).toBe(av);

    nodes.setDustTexture(null);
    nodes.setAvPrepassTexture(null);
    expect(nodes.dust.value).toBe(dustPlaceholder);
    expect(nodes.avPrepass.value).toBe(avPlaceholder);

    volume.dispose();
    av.dispose();
    nodes.dispose();
  });

  // The prepass march and the star vertex fallback sample the SAME node.
  // Two nodes would make the A/B toggle change the picture: one branch
  // reading dust, the other an empty placeholder (README.md § Two nodes).
  it('releases both slots on dispose so nothing holds the volume', () => {
    const nodes = new ExtinctionTextureNodes();
    const volume = createVoxelTexture(4, new Uint8Array(64));
    nodes.setDustTexture(volume);
    nodes.dispose();
    expect(nodes.dust.value).not.toBe(volume);
    volume.dispose();
  });

  // The pair is boot-scoped and only WebGpuSeam.dispose() reaches it
  // (boot-webgpu.ts), so the placeholders' own release is the half a
  // slot-repoint test would silently miss.
  it('disposes the placeholders themselves, not just the slot bindings', () => {
    const nodes = new ExtinctionTextureNodes();
    const dustSpy = vi.spyOn(nodes.dust.value, 'dispose');
    const avSpy = vi.spyOn(nodes.avPrepass.value, 'dispose');
    nodes.dispose();
    expect(dustSpy).toHaveBeenCalled();
    expect(avSpy).toHaveBeenCalled();
  });
});
