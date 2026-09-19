import { describe, expect, it } from 'vitest';
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
    mirror.stage(av, 1);
    expect(mirror.read(0)).toBeNull();
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBe(1);
    expect(mirror.read(3)).toBe(4);
  });

  it('reads null past the end rather than undefined', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av, 1);
    landAll();
    await Promise.resolve();
    expect(mirror.read(99)).toBeNull();
  });

  // One copy per generation is what makes a pointermove sweep cost one
  // readback rather than one per event.
  it('stages at most one copy per generation', () => {
    const { mirror, av, reads } = make();
    mirror.stage(av, 1);
    mirror.stage(av, 1);
    mirror.stage(av, 1);
    expect(reads).toHaveLength(1);
    mirror.stage(av, 2);
    expect(reads).toHaveLength(2);
  });

  // The epoch, not the generation: a dispatch can rewrite the buffer without
  // anything having asked for a copy, and the in-flight one is then stale.
  it('drops a copy the next invalidate superseded', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av, 1);
    mirror.invalidate();
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBeNull();
  });

  it('drops the landed table on invalidate', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av, 1);
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBe(1);
    mirror.invalidate();
    expect(mirror.read(0)).toBeNull();
  });

  it('ignores a copy that lands after dispose', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av, 1);
    mirror.dispose();
    landAll();
    await Promise.resolve();
    expect(mirror.read(0)).toBeNull();
  });
});
