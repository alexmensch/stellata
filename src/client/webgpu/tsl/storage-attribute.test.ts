import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  disposeStorageAttribute, supportsVertexStageStorageBuffers,
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

  // No limit means the device predates the compatibility feature level that
  // introduced it, so core limits apply and a vertex stage gets its eight.
  it('accepts a device that reports no such limit at all', () => {
    expect(supportsVertexStageStorageBuffers(rendererReporting({}))).toBe(true);
    expect(supportsVertexStageStorageBuffers(rendererReporting(null))).toBe(true);
  });
});
