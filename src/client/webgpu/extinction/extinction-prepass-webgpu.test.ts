import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3, type BufferAttribute } from 'three';
import type { ComputeNode, StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { RECOMPUTE_EPSILON_PC } from '../../star-pipeline/extinction/extinction-prepass-pure';
import { STAR_VISIBILITY_BOUND_KEYS } from '../star/star-visibility-tsl';
import { makeStarLayerSources } from '../star/star-sources-mock';
import { StarTables } from '../star/star-tables';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { WebGpuExtinctionPrepass } from './extinction-prepass-webgpu';
import { ExtinctionNodes } from './extinction-nodes';
import { scrambledLattice } from './dispatch-order/dispatch-order-fixture';
import { REFILL_SLICES, refillSliceLength } from './refill/refill-slices-pure';

/** A renderer whose readbacks resolve only when the test says so — the
 *  frame-decoupled semantics a cold read has to live with. */
function fakeRenderer() {
  const computes: ComputeNode[] = [];
  /** The slot span of each dispatch, in call order. */
  const dispatched: (number | undefined)[] = [];
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
    compute: (node: ComputeNode, dispatchSize?: number) => {
      dispatched.push(dispatchSize);
      return computes.push(node);
    },
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
    dispatched,
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

/** Fly the camera to `x` and let it stop: the displacing frame starts a
 *  refill cycle and the rest of the cycle runs out while it holds still.
 *  Only a frame after the cycle parks is one a pick can be staged for,
 *  which is the shape every warming test wants. */
function moveAndSettle(prepass: { update(x: number, y: number, z: number): void }, x: number) {
  for (let frame = 0; frame <= REFILL_SLICES; frame++) prepass.update(x, 0, 0);
}

/** Star i at (3i, 3i+1, 3i+2) unless a test wants a field of its own: a
 *  monotone diagonal, so a slot's contents name the star that filled it. */
function diagonal(count: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) positions[i] = i;
  return positions;
}

/** The uint buffer with nonzero contents — the other one is stamps. */
function orderTable(released: readonly BufferAttribute[]): Uint32Array {
  return released
    .map((a) => a.array)
    .filter((a): a is Uint32Array => a instanceof Uint32Array)
    .find((a) => a.some((v) => v !== 0)) ?? new Uint32Array(0);
}

/** A camera at the origin looking down −z, as the shell would hand it. */
function viewAt(yawRad: number) {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.01, 1e5);
  camera.rotation.set(0, yawRad, 0);
  return { camera, worldOffset: new Vector3() };
}

function makePrepass(
  count = COUNT,
  positions: Float32Array = diagonal(count),
  gated = true,
) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const slots = new ExtinctionNodes();
  const fake = fakeRenderer();
  // The gate reads per-star statics, so it needs the star layer's tables —
  // built over the mock's zero-filled attributes, which is enough for the
  // graph to compose; what it evaluates to is the A/B parity smoke's.
  const tables = gated ? new StarTables(makeStarLayerSources(count).sources) : null;
  const prepass = new WebGpuExtinctionPrepass({
    renderer: fake.renderer,
    positions,
    count,
    nodes: buildSharedUniformNodes(shared).nodes,
    slots,
    uniforms: shared,
    tables,
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

describe('spreading the refill', () => {
  // The first fill is whole: until it lands every consumer runs its own
  // in-vertex march, which is dearer than the dispatch it waits on.
  it('fills the whole catalogue on the first frame, then slices', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(dispatched).toEqual([COUNT]);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(dispatched[1]).toBe(refillSliceLength(COUNT));
  });

  it('covers the catalogue exactly once per cycle', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    dispatched.length = 0;
    for (let frame = 1; frame <= REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    }
    expect(dispatched).toHaveLength(REFILL_SLICES);
    expect(dispatched.reduce<number>((n, len) => n + (len ?? 0), 0)).toBe(COUNT);
  });

  it('parks once the cycle has run out and nothing has asked again', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    for (let frame = 0; frame < 20; frame++) prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(1 + REFILL_SLICES);
  });

  // A camera crossing the epsilon every frame asks every frame. Restarting
  // the cycle on each request would refill the first slice forever and
  // leave every other star at the value the boot fill gave it.
  it('refills the whole catalogue before the parity march', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    dispatched.length = 0;
    // The reference march wants a render target the fake has no answer for;
    // the dispatch that precedes it is what a bit compare rests on.
    void prepass.verifyParity().catch(() => {});
    expect(dispatched).toEqual([COUNT]);
  });

  it('keeps cycling under a request that fires every frame', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    dispatched.length = 0;
    for (let frame = 1; frame <= 2 * REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2 * frame, 0, 0);
    }
    expect(dispatched).toHaveLength(2 * REFILL_SLICES);
    expect(dispatched.reduce<number>((n, len) => n + (len ?? 0), 0)).toBe(2 * COUNT);
  });
});

describe('only what is in frame', () => {
  // The first fill records the view, so a still view the next frame is free.
  it('a still view at a parked camera dispatches nothing', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(0, 0, 0, viewAt(0));
    expect(dispatched).toEqual([COUNT]);
  });

  it('a turned view sweeps the whole slot range, each frame it turns', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(0, 0, 0, viewAt(0.1));
    prepass.update(0, 0, 0, viewAt(0.2));
    prepass.update(0, 0, 0, viewAt(0.2));
    expect(dispatched).toEqual([COUNT, COUNT, COUNT]);
  });

  it('a translation past epsilon runs the slice cycle, not a sweep, view turning or not', () => {
    const { prepass, dispatched, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0, viewAt(0.1));
    expect(dispatched[1]).toBe(refillSliceLength(COUNT));
    for (let frame = 2; frame <= REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0, viewAt(0.1 * frame));
    }
    expect(dispatched.slice(1).reduce<number>((n, len) => n + (len ?? 0), 0)).toBe(COUNT);
  });

  it('a sweep frame stages no mirror; the still frame after it does', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(0, 0, 0, viewAt(0.1));
    prepass.warmAvReadback();
    expect(reads).toHaveLength(0);
    prepass.update(0, 0, 0, viewAt(0.1));
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });

  // see ../refill/README.md § The generation stamp
  it('a camera creeping under epsilon per frame keeps recomputing', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let frame = 1; frame <= 40; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 0.6 * frame, 0, 0);
    }
    // 40 frames × 0.6 ε is 24 ε of travel: a bump every second frame, each
    // extending the cycle, so the kernel ran on nearly every frame.
    expect(computes.length).toBeGreaterThan(1 + 2 * REFILL_SLICES);
  });
});

describe('the dispatch order', () => {
  const SIDE = 8;
  const LATTICE_COUNT = SIDE ** 3;

  /** The two tables the kernel pairs, read back off the dispose registry —
   *  nothing else exposes a buffer no geometry owns. The order table is the
   *  uint buffer whose contents are a permutation; the stamp buffer is the
   *  other one and starts all zero. */
  function tables(count: number, positions: Float32Array) {
    const { prepass, released, attachDust } = makePrepass(count, positions);
    attachDust();
    prepass.update(0, 0, 0);
    prepass.dispose();
    return {
      slotPositions: released.find((a) => a.itemSize === 4)!.array as Float32Array,
      starOfSlot: orderTable(released),
    };
  }

  // The pairing is the bug this can have: a position table sorted one way
  // and an order table sorted another writes every star's A_V onto some
  // other star. It bites only on a field the sort actually permutes — a
  // monotone one sorts to the identity and pairs correctly by accident, so
  // the non-identity assertion below is what keeps the rest honest.
  it('packs each slot with the star its order table names', () => {
    const positions = scrambledLattice(SIDE, 331);
    const { slotPositions, starOfSlot } = tables(LATTICE_COUNT, positions);
    expect(new Set(starOfSlot).size).toBe(LATTICE_COUNT);
    expect(Array.from(starOfSlot))
      .not.toEqual(Array.from({ length: LATTICE_COUNT }, (_, i) => i));
    for (const slot of [0, 1, 7, 300, LATTICE_COUNT - 1]) {
      const star = starOfSlot[slot];
      expect(Array.from(slotPositions.slice(slot * 4, slot * 4 + 4))).toEqual(
        [positions[star * 3], positions[star * 3 + 1], positions[star * 3 + 2], 0]);
    }
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

  it('an idle camera stays free once the cycle the move started has run out', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    moveAndSettle(prepass, RECOMPUTE_EPSILON_PC * 2);
    const settled = computes.length;
    for (let frame = 0; frame < 10; frame++) prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(settled);
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

  it('the A/B switch does not leave a half-refilled cycle running', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    prepass.setEnabled(false);
    const held = computes.length;
    for (let frame = 0; frame < 10; frame++) prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(held);
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

describe('the cache gate', () => {
  // The vertex-stage prefilter needs no invalidation because it re-runs
  // every frame. This one is a cache: raising the aperture raises
  // uCullMag, and a filter change moves the mask or the distance band —
  // each makes a star the last dispatch skipped renderable, with no
  // camera motion to fire the displacement gate.
  it.each(STAR_VISIBILITY_BOUND_KEYS)('%s moving refills a parked camera', (key) => {
    const { prepass, computes, shared, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1);
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1);
    shared[key].value += 1;
    // The cycle it starts refills the WHOLE catalogue over the next
    // REFILL_SLICES frames — a bound that landed in one slice and nowhere
    // else would leave most of the buffer answering to the old aperture.
    for (let frame = 0; frame < REFILL_SLICES; frame++) prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1 + REFILL_SLICES);
    // And settles again: a watch that re-fired every frame would cost the
    // whole march per frame at a parked camera.
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1 + REFILL_SLICES);
  });

  // uModelDays is deliberately absent above: the gate credits every star
  // its whole brightward pulsation swing rather than its live phase, so
  // the running clock moves nothing it reads.
  it('the model clock is not one of them', () => {
    expect(STAR_VISIBILITY_BOUND_KEYS).not.toContain('uModelDays');
  });

  it('every bound is a slot of the shared map the shell writes', () => {
    const shared = buildSharedUniforms({
      pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600,
      hdr: makeHdrEmitterUniforms(),
    });
    for (const key of STAR_VISIBILITY_BOUND_KEYS) {
      expect(typeof shared[key].value).toBe('number');
    }
  });

  // Without tables there is nothing per-star to gate on, and the kernel
  // marches the catalogue exactly as it did before.
  it('an ungated pass watches nothing and still dispatches', () => {
    const { prepass, computes, shared, attachDust } = makePrepass(COUNT, diagonal(COUNT), false);
    attachDust();
    prepass.update(0, 0, 0);
    shared.uCullMag.value += 1;
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1);
  });
});

describe('the epoch refresh', () => {
  // StarFrame rewrites catalog.positions in place every bucket the model
  // clock crosses. The table packed at attach is a copy, so without this
  // the march — and the gate over it — stay at the attach epoch.
  it('re-packs from the array the space-motion pass rewrote, and refills', () => {
    const positions = diagonal(COUNT);
    const { prepass, computes, released, attachDust } = makePrepass(COUNT, positions);
    attachDust();
    prepass.update(0, 0, 0);
    positions[0] = 4321;
    prepass.refreshPositions();
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(2);
    prepass.dispose();
    const slotPositions = released.find((a) => a.itemSize === 4)!.array as Float32Array;
    const starOfSlot = orderTable(released);
    const slot = starOfSlot.indexOf(0);
    expect(slotPositions[slot * 4]).toBe(4321);
  });

  it('is inert after dispose rather than writing a released buffer', () => {
    const { prepass, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.dispose();
    expect(() => prepass.refreshPositions()).not.toThrow();
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

  // A mirror taken mid-cycle is superseded by the next slice before the
  // dwell that wanted it can read a byte, so the cycle has to park first.
  it('warms on the frame the cycle the move started parks, not before', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let frame = 1; frame < REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
      prepass.warmAvReadback();
      expect(reads, `frame ${frame} of the cycle`).toHaveLength(0);
    }
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });

  // A dust chunk landing on a parked camera recomputes too, and once its
  // cycle parks that IS a frame a pick can be staged for — gating on the
  // recompute rather than on the cycle would swallow it.
  it('warms through a dirty recompute the camera did not cause', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.warmAvReadback();
    reads.length = 0;
    prepass.markDirty();
    for (let frame = 0; frame <= REFILL_SLICES; frame++) prepass.update(0, 0, 0);
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

  // None of the four sits in a geometry, so nothing but this call frees
  // them (../tsl/README.md § Storage attributes).
  it('frees all four storage buffers through the renderer registry', () => {
    const { prepass, slots, released, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const av = slots.av.value as StorageBufferAttribute;
    prepass.dispose();
    expect(released).toContain(av);
    expect(released).toHaveLength(4);
    const positions = released.find((a) => a.itemSize === 4)!;
    expect(positions.count).toBe(COUNT);
    const uints = released.filter((a) => a.array instanceof Uint32Array);
    expect(uints).toHaveLength(2);
    for (const u of uints) expect(u.count).toBe(COUNT);
  });

  // The buffer and the parity check's CPU copy are one array, so releasing
  // the buffer alone leaves 1.48 MiB alive behind the surviving field.
  it('drops the CPU order copy with the buffer', async () => {
    const { prepass, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.dispose();
    await expect(prepass.verifyParity()).resolves.toBeNull();
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
