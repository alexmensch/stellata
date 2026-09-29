import { describe, expect, it, vi } from 'vitest';
import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { AvMirror } from './av-mirror';

const COUNT = 4;

function make() {
  const reads: (() => void)[] = [];
  let settle: ((bytes: ArrayBuffer) => void) | null = null;
  const renderer = {
    getArrayBufferAsync: () => new Promise<ArrayBuffer>((resolve) => {
      settle = resolve;
      reads.push(() => resolve(Float32Array.from([1, 2, 3, 4]).buffer));
    }),
  };
  return {
    reads,
    landAll: () => { for (const r of reads.splice(0)) r(); },
    get settle() { return settle; },
    mirror: new AvMirror(renderer as unknown as WebGPURenderer),
    av: { count: COUNT } as unknown as StorageBufferAttribute,
  };
}

describe('AvMirror', () => {
  it('answers null until a staged copy lands, then out of the copy', async () => {
    const { mirror, av, landAll } = make();
    expect(mirror.read(0)).toBeNull();
    mirror.stage(av);
    expect(mirror.read(0)).toBeNull();
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBe(1);
    expect(mirror.read(3)).toBe(4);
  });

  it('reads null past the end rather than undefined', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    landAll();
    await Promise.resolve();
    expect(mirror.read(99)).toBeNull();
  });

  // One copy per invalidate is what makes a pointermove sweep cost one
  // readback rather than one per event.
  it('stages at most one copy between invalidates, landed or not', async () => {
    const { mirror, av, reads, landAll } = make();
    mirror.stage(av);
    mirror.stage(av);
    expect(reads).toHaveLength(1);
    landAll();
    await Promise.resolve();
    mirror.stage(av);
    expect(reads).toHaveLength(0);
    mirror.invalidate();
    mirror.stage(av);
    expect(reads).toHaveLength(1);
  });

  it('a failed map is not re-armed until the next invalidate', async () => {
    const renderer = { getArrayBufferAsync: vi.fn(() => Promise.reject(new Error('map failed'))) };
    const mirror = new AvMirror(renderer as unknown as WebGPURenderer);
    const av = { count: COUNT } as unknown as StorageBufferAttribute;
    mirror.stage(av);
    await Promise.resolve();
    await Promise.resolve();
    mirror.stage(av);
    expect(renderer.getArrayBufferAsync).toHaveBeenCalledTimes(1);
    expect(mirror.read(0)).toBeNull();
    mirror.invalidate();
    mirror.stage(av);
    expect(renderer.getArrayBufferAsync).toHaveBeenCalledTimes(2);
  });

  // A dispatch can rewrite the buffer without anything having asked for a
  // copy, and the in-flight one is then stale.
  it('drops a copy the next invalidate superseded', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    mirror.invalidate();
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBeNull();
  });

  it('drops the landed table on invalidate', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBe(1);
    mirror.invalidate();
    expect(mirror.read(0)).toBeNull();
  });

  it('ignores a copy that lands after dispose', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    mirror.dispose();
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBeNull();
  });
});
