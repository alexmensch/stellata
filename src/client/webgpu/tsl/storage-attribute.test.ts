import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute } from 'three';
import { storage } from 'three/tsl';
import { StorageBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import {
  disposeStorageAttribute, storageWriteRead, supportsVertexStageStorageBuffers,
} from './storage-attribute';

const rendererReporting = (limits: Record<string, number> | null) => ({
  backend: { device: limits === null ? null : { limits } },
} as unknown as WebGPURenderer);

describe('disposeStorageAttribute', () => {
  it('deletes the attribute from the renderer registry that owns its GPU buffer', () => {
    const remove = vi.fn();
    const attr = new BufferAttribute(new Float32Array(4), 1);
    disposeStorageAttribute(
      { _attributes: { delete: remove } } as unknown as WebGPURenderer, attr);
    expect(remove).toHaveBeenCalledWith(attr);
  });

  it('is a no-op before the renderer initialised', () => {
    const attr = new BufferAttribute(new Float32Array(4), 1);
    expect(() => disposeStorageAttribute(
      { _attributes: null } as unknown as WebGPURenderer, attr)).not.toThrow();
  });
});

describe('storageWriteRead', () => {
  const dispatch = () => new StorageBufferAttribute(new Uint32Array(3), 1);

  // The shape this exists to make unwritable: one node narrowed for the
  // reader is the writer's node too, so the writing kernel emits a store
  // three accepts and the device refuses at pipeline creation.
  it('narrows the node it is called on, so one node cannot serve both', () => {
    const node = storage(dispatch(), 'uint', 3);
    expect(node.toReadOnly()).toBe(node);
    expect(node.access).toBe('readOnly');
  });

  it('builds a separate node per side and narrows only the reader', () => {
    const attribute = dispatch();
    const { write, read } = storageWriteRead(() => storage(attribute, 'uint', 3));
    expect(write).not.toBe(read);
    expect(read.access).toBe('readOnly');
    expect(write.access).not.toBe('readOnly');
  });

  it('binds both sides to the one attribute', () => {
    const attribute = dispatch();
    const { write, read } = storageWriteRead(() => storage(attribute, 'uint', 3));
    expect(write.value).toBe(attribute);
    expect(read.value).toBe(attribute);
  });
});

// The star vertex stage indexes the A_V cache out of a storage buffer, and a
// device holding none there fails all three star pipelines — one invalid
// pipeline discards the whole submit, so the boot refuses rather than paint
// black (../README.md § One scene per boot).
describe('supportsVertexStageStorageBuffers', () => {
  it('refuses a device reporting none in the vertex stage', () => {
    expect(supportsVertexStageStorageBuffers(
      rendererReporting({ maxStorageBuffersInVertexStage: 0 }))).toBe(false);
  });

  it('accepts a device reporting any', () => {
    expect(supportsVertexStageStorageBuffers(
      rendererReporting({ maxStorageBuffersInVertexStage: 8 }))).toBe(true);
  });

  it('holds the device to the count the star vertex stage binds', () => {
    const six = rendererReporting({ maxStorageBuffersInVertexStage: 6 });
    expect(supportsVertexStageStorageBuffers(six, 7)).toBe(false);
    expect(supportsVertexStageStorageBuffers(six, 6)).toBe(true);
  });

  // No limit means the device predates the compatibility feature level that
  // introduced it, so core limits apply and a vertex stage gets its eight.
  it('accepts a device that reports no such limit at all', () => {
    expect(supportsVertexStageStorageBuffers(rendererReporting({}))).toBe(true);
    expect(supportsVertexStageStorageBuffers(rendererReporting(null))).toBe(true);
  });
});
