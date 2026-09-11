import { describe, expect, it, vi } from 'vitest';
import type { BufferAttribute } from 'three';
import type { ComputeNode, StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { RECOMPUTE_EPSILON_PC } from '../../star-pipeline/extinction/extinction-prepass-pure';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { WebGpuExtinctionPrepass } from './extinction-prepass-webgpu';
import { ExtinctionNodes } from './extinction-nodes';

/** A renderer whose readbacks resolve only when the test says so — the
 *  frame-decoupled semantics a cold read has to live with. */
function fakeRenderer() {
  const computes: ComputeNode[] = [];
  const reads: {
    attr: BufferAttribute; offset: number; count: number; land: (bytes: ArrayBuffer) => void;
  }[] = [];
  const released: BufferAttribute[] = [];
  const setRenderTarget = vi.fn();
  const renderer = {
    compute: (node: ComputeNode) => computes.push(node),
    setRenderTarget,
    getArrayBufferAsync: (attr: BufferAttribute, _t: null, offset: number, count: number) =>
      new Promise<ArrayBuffer>((resolve) => { reads.push({ attr, offset, count, land: resolve }); }),
    _attributes: { delete: (a: BufferAttribute) => released.push(a) },
  };
  return {
    renderer: renderer as unknown as WebGPURenderer,
    computes,
    reads,
    released,
    setRenderTarget,
  };
}

const COUNT = 2048;
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });
const bytesOf = (v: number) => new Float32Array([v]).buffer;

function makePrepass(count = COUNT) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const slots = new ExtinctionNodes();
  const fake = fakeRenderer();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) positions[i] = i;
  const prepass = new WebGpuExtinctionPrepass({
    renderer: fake.renderer,
    positions,
    count,
    nodes: buildSharedUniformNodes(shared).nodes,
    slots,
    uniforms: shared,
  });
  const attachDust = () => {
    shared.uDustTexture.value = createVoxelTexture(4, new Uint8Array(64));
    slots.setDustTexture(shared.uDustTexture.value);
  };
  return { ...fake, prepass, shared, slots, attachDust };
}

describe('construction', () => {
  it('needs no float-target extension — that verdict has no WebGPU analogue', () => {
    expect(makePrepass().prepass.supported).toBe(true);
  });

  it('points the consumer slot at a one-float-per-star buffer immediately', () => {
    const { prepass, slots } = makePrepass();
    // uAvPrepassEnabled is the gate, not the binding, so an uncomputed
    // buffer is bound and simply never indexed.
    expect(prepass.isActive()).toBe(false);
    const av = slots.av.value as StorageBufferAttribute;
    expect(av.isStorageBufferAttribute).toBe(true);
    expect(av.count).toBe(COUNT);
    expect(av.itemSize).toBe(1);
    prepass.dispose();
  });

  it('dispatches one thread per star', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(computes[0].count).toBe(COUNT);
  });
});

describe('the displacement gate', () => {
  it('costs nothing without dust, then computes once on the first frame', () => {
    const { prepass, computes, attachDust } = makePrepass();
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(0);
    attachDust();
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1);
  });

  it('an idle camera is free; a move past epsilon recomputes', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 0.5, 0, 0);
    expect(computes).toHaveLength(1);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(2);
  });

  // A compute pass binds no render target, so the ends-at-the-canvas
  // contract the fragment twin kept (../hdr/reduction-webgpu.ts) has
  // nothing here to hold — pin that nothing is bound at all.
  it('never touches the render-target binding', () => {
    const { prepass, setRenderTarget, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(setRenderTarget).not.toHaveBeenCalled();
  });

  it('markDirty recomputes without any camera motion — a voxel chunk landed', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.markDirty();
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(2);
  });

  it('the A/B switch pauses maintenance, so the fallback side pays no fill', () => {
    const { prepass, computes, shared, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.setEnabled(false);
    expect(shared.uAvPrepassEnabled.value).toBe(0);
    prepass.update(1e6, 0, 0);
    expect(computes).toHaveLength(1);
    prepass.setEnabled(true);
    expect(shared.uAvPrepassEnabled.value).toBe(1);
  });
});

describe('cold reads', () => {
  it('answers null while inert — no cache, which is not no dust', () => {
    const { prepass, reads } = makePrepass();
    expect(prepass.readAvMag(7)).toBeNull();
    expect(reads).toHaveLength(0);
  });

  it('warms the memo off one 4-byte copy at the star offset, then answers exactly', async () => {
    const { prepass, reads, slots, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const idx = 1029;
    expect(prepass.readAvMag(idx)).toBeNull();
    expect(reads).toHaveLength(1);
    expect(reads[0].attr).toBe(slots.av.value);
    expect(reads[0].offset).toBe(idx * 4);
    expect(reads[0].count).toBe(4);
    reads[0].land(bytesOf(0.375));
    await flush();
    expect(prepass.readAvMag(idx)).toBe(0.375);
    expect(reads).toHaveLength(1);
  });

  it('issues one copy per index in flight, not one per asking frame', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let i = 0; i < 5; i++) expect(prepass.readAvMag(3)).toBeNull();
    expect(reads).toHaveLength(1);
  });

  // The WebGL twin clears its memo inside the recompute; here the read can
  // outlive the buffer's contents, so the generation counter is that same
  // invalidation rule expressed for a promise (README.md § Cold reads).
  it('drops a read that resolves against a superseded buffer', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(prepass.readAvMag(3)).toBeNull();
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    reads[0].land(bytesOf(9));
    await flush();
    expect(prepass.readAvMag(3)).toBeNull();
    expect(reads).toHaveLength(2);
  });

  it('a recompute re-asks rather than serving the previous frame\'s value', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.readAvMag(3);
    reads[0].land(bytesOf(0.5));
    await flush();
    expect(prepass.readAvMag(3)).toBe(0.5);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(prepass.readAvMag(3)).toBeNull();
    expect(reads).toHaveLength(2);
  });
});

describe('dispose', () => {
  it('releases the consumer slot and the gate', () => {
    const { prepass, slots, shared, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const av = slots.av.value;
    prepass.dispose();
    expect(shared.uAvPrepassEnabled.value).toBe(0);
    expect(slots.av.value).not.toBe(av);
    expect(prepass.isActive()).toBe(false);
  });

  // Neither buffer sits in a geometry, so nothing but this call frees
  // them (../tsl/README.md § Storage attributes).
  it('frees both storage buffers through the renderer registry', () => {
    const { prepass, slots, released, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const av = slots.av.value as StorageBufferAttribute;
    prepass.dispose();
    expect(released).toContain(av);
    expect(released).toHaveLength(2);
    const positions = released.find((a) => a !== av)!;
    expect(positions.itemSize).toBe(4);
    expect(positions.count).toBe(COUNT);
    // The vec4 packing, w left at zero: star 1's xyz sits at slot 1.
    expect(Array.from(positions.array.slice(4, 8))).toEqual([3, 4, 5, 0]);
  });

  it('a read in flight at dispose cannot land on a released cache', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.readAvMag(3);
    prepass.dispose();
    reads[0].land(bytesOf(1));
    await flush();
    expect(prepass.readAvMag(3)).toBeNull();
  });
});
