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
    attr: BufferAttribute;
    offset: number | undefined;
    count: number | undefined;
    land: (bytes: ArrayBuffer) => void;
    fail: (e: Error) => void;
  }[] = [];
  const released: BufferAttribute[] = [];
  const setRenderTarget = vi.fn();
  const renderer = {
    compute: (node: ComputeNode) => computes.push(node),
    setRenderTarget,
    getArrayBufferAsync: (attr: BufferAttribute, _t?: null, offset?: number, count?: number) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        reads.push({ attr, offset, count, land: resolve, fail: reject });
      }),
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
/** A whole-table readback whose star `i` carries `i / 8`, so a test can
 *  tell a value read at the right offset from one read at any other. */
const tableOf = (count = COUNT) => Float32Array.from({ length: count }, (_, i) => i / 8).buffer;

/** Fly the camera to `x` and let it stop: the displacing frame recomputes,
 *  the next one holds still. Only the second is a frame a pick can be
 *  staged for, which is the shape every warming test wants. */
function moveAndSettle(prepass: { update(x: number, y: number, z: number): void }, x: number) {
  prepass.update(x, 0, 0);
  prepass.update(x, 0, 0);
}

/** Star i at (3i, 3i+1, 3i+2) unless a test wants a field of its own: a
 *  monotone diagonal, so a slot's contents name the star that filled it. */
function diagonal(count: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) positions[i] = i;
  return positions;
}

function makePrepass(count = COUNT, positions: Float32Array = diagonal(count)) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const slots = new ExtinctionNodes();
  const fake = fakeRenderer();
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

describe('the dispatch order', () => {
  /** The two tables the kernel pairs, read back off the dispose registry —
   *  nothing else exposes a buffer no geometry owns. */
  function tables(count = COUNT, positions?: Float32Array) {
    const { prepass, released, attachDust } = makePrepass(count, positions);
    attachDust();
    prepass.update(0, 0, 0);
    prepass.dispose();
    return {
      slotPositions: released.find((a) => a.itemSize === 4)!.array as Float32Array,
      starOfSlot: released.find((a) => a.array instanceof Uint32Array)!.array as Uint32Array,
    };
  }

  // The pairing is the bug this can have: a position table sorted one way
  // and an order table sorted another writes every star's A_V onto some
  // other star. The vec4 packing, w left at zero, rides along.
  it('packs each slot with the star its order table names', () => {
    const { slotPositions, starOfSlot } = tables();
    for (const slot of [0, 1, 7, 1029, COUNT - 1]) {
      const star = starOfSlot[slot];
      expect(Array.from(slotPositions.slice(slot * 4, slot * 4 + 4)))
        .toEqual([star * 3, star * 3 + 1, star * 3 + 2, 0]);
    }
  });

  // A catalogue whose records arrive in no spatial order is the case the
  // reorder exists for — 8³ cells walked by a stride coprime with the count.
  it('dispatches a spatially unordered catalogue out of catalogue order', () => {
    const side = 8;
    const count = side ** 3;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const cell = (i * 331) % count;
      positions[i * 3] = (cell % side) * 10;
      positions[i * 3 + 1] = (Math.floor(cell / side) % side) * 10;
      positions[i * 3 + 2] = Math.floor(cell / (side * side)) * 10;
    }
    const { starOfSlot } = tables(count, positions);
    expect(new Set(starOfSlot).size).toBe(count);
    expect(Array.from(starOfSlot)).not.toEqual(Array.from({ length: count }, (_, i) => i));
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

describe('the pick mirror', () => {
  it('answers null while inert — no cache, which is not no dust', () => {
    const { prepass, reads } = makePrepass();
    expect(prepass.readAvMag(7)).toBeNull();
    prepass.warmAvReadback();
    expect(reads).toHaveLength(0);
  });

  // The read the pick itself would issue cannot resolve before the verdict
  // it was meant to decide, which is the whole reason the warm exists.
  it('a pick that never warmed reads null and issues no copy of its own', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(prepass.readAvMag(1029)).toBeNull();
    expect(reads).toHaveLength(0);
  });

  it('warms off one copy of the whole buffer, then answers every star exactly', async () => {
    const { prepass, reads, slots, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
    expect(reads[0].attr).toBe(slots.av.value);
    expect(reads[0].offset).toBeUndefined();
    expect(reads[0].count).toBeUndefined();
    reads[0].land(tableOf());
    await flush();
    expect(prepass.readAvMag(1029)).toBe(1029 / 8);
    expect(prepass.readAvMag(0)).toBe(0);
    expect(prepass.readAvMag(COUNT - 1)).toBe((COUNT - 1) / 8);
    expect(reads).toHaveLength(1);
  });

  it('a star past the catalogue reads null rather than undefined', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    reads[0].land(tableOf());
    await flush();
    expect(prepass.readAvMag(COUNT)).toBeNull();
  });

  it('costs one copy per pointer sweep, not one per event', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let i = 0; i < 5; i++) prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });

  // The WebGL twin clears its memo inside the recompute; here the read can
  // outlive the buffer's contents, so the generation counter is that same
  // invalidation rule expressed for a promise (README.md § Cold reads).
  it('drops a read that resolves against a superseded buffer', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    moveAndSettle(prepass, RECOMPUTE_EPSILON_PC * 2);
    reads[0].land(tableOf());
    await flush();
    expect(prepass.readAvMag(3)).toBeNull();
    prepass.warmAvReadback();
    expect(reads).toHaveLength(2);
  });

  it('a recompute re-asks rather than serving the previous frame\'s table', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    reads[0].land(tableOf());
    await flush();
    expect(prepass.readAvMag(3)).toBe(0.375);
    moveAndSettle(prepass, RECOMPUTE_EPSILON_PC * 2);
    expect(prepass.readAvMag(3)).toBeNull();
    prepass.warmAvReadback();
    expect(reads).toHaveLength(2);
  });

  // Otherwise a device that refuses the map pays a 1.5 MiB copy per
  // pointer event for as long as the buffer stands.
  it('a refused map costs one attempt per recompute, not one per event', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    reads[0].fail(new Error('map failed'));
    await flush();
    for (let i = 0; i < 5; i++) prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
    moveAndSettle(prepass, RECOMPUTE_EPSILON_PC * 2);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(2);
  });

  // A warp or a focus lerp recomputes every frame, so a copy issued then is
  // superseded before it lands — the pick reads null and errs pickable
  // across that stretch whether or not the copy was spent.
  it('spends nothing while the camera is still recomputing every frame', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let frame = 1; frame <= 5; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2 * frame, 0, 0);
      prepass.warmAvReadback();
      prepass.warmAvReadback();
    }
    expect(reads).toHaveLength(0);
  });

  it('warms on the first frame the camera holds still', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });

  // A dust chunk landing on a parked camera recomputes too, and that frame
  // is one a pick CAN be staged for — gating on the recompute rather than
  // on the displacement would swallow it.
  it('warms through a dirty recompute the camera did not cause', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    reads.length = 0;
    prepass.markDirty();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
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

  // None of the three sits in a geometry, so nothing but this call frees
  // them (../tsl/README.md § Storage attributes).
  it('frees all three storage buffers through the renderer registry', () => {
    const { prepass, slots, released, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const av = slots.av.value as StorageBufferAttribute;
    prepass.dispose();
    expect(released).toContain(av);
    expect(released).toHaveLength(3);
    const positions = released.find((a) => a.itemSize === 4)!;
    expect(positions.count).toBe(COUNT);
    const order = released.find((a) => a.array instanceof Uint32Array)!;
    expect(order.count).toBe(COUNT);
  });

  it('a read in flight at dispose cannot land on a released cache', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    prepass.dispose();
    reads[0].land(tableOf());
    await flush();
    expect(prepass.readAvMag(3)).toBeNull();
  });
});
