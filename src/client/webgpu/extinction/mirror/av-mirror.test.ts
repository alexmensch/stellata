import { describe, expect, it } from 'vitest';
import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { AvMirror } from './av-mirror';

const COUNT = 4;

const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

function make() {
  const reads: { land(): void; fail(): void }[] = [];
  const renderer = {
    getArrayBufferAsync: () => new Promise<ArrayBuffer>((resolve, reject) => {
      reads.push({
        land: () => resolve(Float32Array.from([1, 2, 3, 4]).buffer),
        fail: () => reject(new Error('map failed')),
      });
    }),
  };
  return {
    reads,
    landAll: () => { for (const r of reads.splice(0)) r.land(); },
    failAll: () => { for (const r of reads.splice(0)) r.fail(); },
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
    await flush();
    expect(mirror.read(0)).toBe(1);
    expect(mirror.read(3)).toBe(4);
  });

  it('reads null past the end rather than undefined', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    landAll();
    await flush();
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
    await flush();
    mirror.stage(av);
    expect(reads).toHaveLength(0);
    mirror.invalidate();
    mirror.stage(av);
    expect(reads).toHaveLength(1);
  });

  it('a failed map is not re-armed until the next invalidate', async () => {
    const { mirror, av, reads, failAll } = make();
    mirror.stage(av);
    failAll();
    await flush();
    mirror.stage(av);
    expect(reads).toHaveLength(0);
    expect(mirror.read(0)).toBeNull();
    mirror.invalidate();
    mirror.stage(av);
    expect(reads).toHaveLength(1);
  });

  // A dispatch can rewrite the buffer without anything having asked for a
  // copy, and the in-flight one is then stale.
  it('drops a copy the next invalidate superseded', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    mirror.invalidate();
    landAll();
    await flush();
    expect(mirror.read(0)).toBeNull();
  });

  it('drops the landed table on invalidate', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    landAll();
    await flush();
    expect(mirror.read(0)).toBe(1);
    mirror.invalidate();
    expect(mirror.read(0)).toBeNull();
  });

  it('ignores a copy that lands after dispose', async () => {
    const { mirror, av, landAll } = make();
    mirror.stage(av);
    mirror.dispose();
    landAll();
    await flush();
    expect(mirror.read(0)).toBeNull();
  });
});
