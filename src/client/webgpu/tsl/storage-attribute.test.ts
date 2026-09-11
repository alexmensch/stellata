import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { disposeStorageAttribute } from './storage-attribute';

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
