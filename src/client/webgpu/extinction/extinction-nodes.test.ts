import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { ExtinctionNodes } from './extinction-nodes';

describe('ExtinctionNodes', () => {
  it('binds both slots to a placeholder before anything attaches', () => {
    const nodes = new ExtinctionNodes();
    expect(nodes.dust.value).not.toBeNull();
    expect(nodes.av.value).not.toBeNull();
    nodes.dispose();
  });

  // The volume slot is BOUND every frame — the uDustEnabled gate is a
  // runtime branch, not a binding decision — so a placeholder three has not
  // seen marked gets replaced by its shared 1x1 2D texture and refused a
  // resize (../../loaders/README.md § Dust voxel upload). That puts a 2D
  // view on a texture_3d binding: the bind group is invalid and the whole
  // submit dies with it. createVoxelTexture does not mark (the volume's
  // mark belongs to the uploader), so this placeholder silently regresses.
  it('marks the volume placeholder needsUpdate, or three substitutes a 2D 1x1', () => {
    const nodes = new ExtinctionNodes();
    expect(nodes.dust.value.version, 'dust placeholder unmarked').toBeGreaterThan(0);
    nodes.dispose();
  });

  it('gives the volume slot a 3D placeholder', () => {
    const nodes = new ExtinctionNodes();
    expect((nodes.dust.value as THREE.Data3DTexture).isData3DTexture).toBe(true);
    nodes.dispose();
  });

  // A swap to a differently-typed texture rebuilds the pipeline instead of
  // rebinding, which is why the placeholder comes from the volume's own
  // factory.
  it('gives the volume placeholder its target format and type', () => {
    const nodes = new ExtinctionNodes();
    const real = createVoxelTexture(4, new Uint8Array(64));
    expect(nodes.dust.value.format).toBe(real.format);
    expect(nodes.dust.value.type).toBe(real.type);
    real.dispose();
    nodes.dispose();
  });

  it('gives the A_V slot a one-float storage placeholder of the consumer stride', () => {
    const nodes = new ExtinctionNodes();
    const placeholder = nodes.av.value as StorageBufferAttribute;
    expect(placeholder.isStorageBufferAttribute).toBe(true);
    expect(placeholder.count).toBe(1);
    expect(placeholder.itemSize).toBe(1);
    expect(placeholder.array).toBeInstanceOf(Float32Array);
    nodes.dispose();
  });

  // Both are bound by the compaction kernel from the first frame, so each
  // needs a valid uint buffer behind it before any prepass exists.
  it('gives the refill stamps and table one-uint placeholders, disarmed', () => {
    const nodes = new ExtinctionNodes();
    for (const slot of [nodes.refill.stamps, nodes.refill.table]) {
      const placeholder = slot.value as StorageBufferAttribute;
      expect(placeholder.isStorageBufferAttribute).toBe(true);
      expect(placeholder.count).toBe(1);
      expect(placeholder.array).toBeInstanceOf(Uint32Array);
    }
    expect(nodes.refill.arm.value).toBe(0);
    expect(nodes.refill.cameraGeneration.value).toBe(1);
    nodes.dispose();
  });

  it('swaps the refill slots in and out together, and disarms on release', () => {
    const nodes = new ExtinctionNodes();
    const stampsPlaceholder = nodes.refill.stamps.value;
    const tablePlaceholder = nodes.refill.table.value;
    const stamps = new StorageBufferAttribute(new Uint32Array(8), 1);
    const table = new StorageBufferAttribute(new Uint32Array(8), 1);
    nodes.refill.setBuffers(stamps, table);
    nodes.refill.arm.value = 1;
    expect(nodes.refill.stamps.value).toBe(stamps);
    expect(nodes.refill.table.value).toBe(table);
    nodes.dispose();
    expect(nodes.refill.stamps.value).toBe(stampsPlaceholder);
    expect(nodes.refill.table.value).toBe(tablePlaceholder);
    expect(nodes.refill.arm.value).toBe(0);
  });

  it('swaps each slot in and back out to its own placeholder', () => {
    const nodes = new ExtinctionNodes();
    const dustPlaceholder = nodes.dust.value;
    const avPlaceholder = nodes.av.value;
    const volume = createVoxelTexture(4, new Uint8Array(64));
    const av = new StorageBufferAttribute(8, 1);

    nodes.setDustTexture(volume);
    nodes.setAvBuffer(av);
    expect(nodes.dust.value).toBe(volume);
    expect(nodes.av.value).toBe(av);

    nodes.setDustTexture(null);
    nodes.setAvBuffer(null);
    expect(nodes.dust.value).toBe(dustPlaceholder);
    expect(nodes.av.value).toBe(avPlaceholder);

    volume.dispose();
    nodes.dispose();
  });

  it('releases both slots on dispose so nothing holds the volume or the buffer', () => {
    const nodes = new ExtinctionNodes();
    const volume = createVoxelTexture(4, new Uint8Array(64));
    const av = new StorageBufferAttribute(8, 1);
    nodes.setDustTexture(volume);
    nodes.setAvBuffer(av);
    nodes.dispose();
    expect(nodes.dust.value).not.toBe(volume);
    expect(nodes.av.value).not.toBe(av);
    volume.dispose();
  });

  // The pair is boot-scoped and only WebGpuSeam.dispose() reaches it
  // (boot-webgpu.ts), so the placeholder's own release is the half a
  // slot-repoint test would silently miss.
  it('disposes the volume placeholder itself, not just the slot binding', () => {
    const nodes = new ExtinctionNodes();
    const dustSpy = vi.spyOn(nodes.dust.value, 'dispose');
    nodes.dispose();
    expect(dustSpy).toHaveBeenCalled();
  });
});
