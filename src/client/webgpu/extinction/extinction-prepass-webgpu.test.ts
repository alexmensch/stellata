import { describe, expect, it, vi } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3, type BufferAttribute } from 'three';
import type { ComputeNode, StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-emitter-uniforms';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { makeColorLutTexture } from '../../star-pipeline/blackbody-lut';
import { RECOMPUTE_EPSILON_PC } from '../../star-pipeline/extinction/extinction-prepass-pure';
import { StarCompaction } from '../star/compaction/star-compaction';
import { STAR_VISIBILITY_BOUND_KEYS } from '../star/star-visibility-tsl';
import { makeStarLayerSources } from '../star/star-sources-mock';
import { StarTables } from '../star/star-tables';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { WebGpuExtinctionPrepass } from './extinction-prepass-webgpu';
import { ExtinctionNodes } from './extinction-nodes';
import { scrambledLattice } from './dispatch-order/dispatch-order-fixture';
import { mortonDispatchOrder } from './dispatch-order/dispatch-order-pure';
import { composeViewProjectionAbs, countInFrameAbs } from './refill/refill-decision-pure';
import { refillWorklistLength } from './refill/refill-buckets-pure';
import { REFILL_SLICES } from './refill/refill-slices-pure';

/** A renderer whose readbacks resolve only when the test says so — the
 *  frame-decoupled semantics a cold read has to live with. */
function fakeRenderer(refill?: { quarter: { value: number } }) {
  const computes: ComputeNode[] = [];
  /** The count of each dispatch, in call order — undefined for an indirect one. */
  const dispatched: (number | undefined)[] = [];
  /** `quarter` as each dispatch was issued, not as `update()` left it: the
   *  consumer's own class, which the very next line overwrites. */
  const dispatchedQuarter: number[] = [];
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
      if (refill !== undefined) dispatchedQuarter.push(refill.quarter.value);
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
    dispatchedQuarter,
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

/** Fly the camera to `x` and let it stop: the displacing frame arms the
 *  compaction and the quarters it lists are marched over the next
 *  REFILL_SLICES frames. Only a frame after the last is one a pick can be
 *  staged for, which is the shape every warming test wants. */
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

/** The permutations among the released uint buffers, in release order:
 *  the order table, then its inverse. The stamps and the worklist are the
 *  other two and start all zero. */
function permutations(released: readonly BufferAttribute[]): Uint32Array[] {
  return released
    .map((a) => a.array)
    .filter((a): a is Uint32Array => a instanceof Uint32Array && a.some((v) => v !== 0));
}

/** A camera at the origin looking down −z, as the shell would hand it. */
function viewAt(yawRad: number) {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.01, 1e5);
  camera.rotation.set(0, yawRad, 0);
  return { camera, worldOffset: new Vector3() };
}

function makePrepass(
  count = COUNT, positions: Float32Array = diagonal(count), loadedCount = count,
) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const slots = new ExtinctionNodes();
  const fake = fakeRenderer(slots.refill);
  const nodes = buildSharedUniformNodes(shared).nodes;
  // The gate reads per-star statics, so it needs the star layer's tables —
  // built over the mock's zero-filled attributes, which is enough for the
  // graph to compose; what it evaluates to is the A/B parity smoke's.
  const tables = new StarTables(makeStarLayerSources(count).sources);
  const compaction = new StarCompaction(fake.renderer, {
    u: nodes, tables, lut: makeColorLutTexture(), dust: slots.dust, av: slots.av,
  }, 6, slots.refill);
  const catalog = { positions, count, loadedCount };
  const prepass = new WebGpuExtinctionPrepass({
    renderer: fake.renderer,
    catalog,
    nodes,
    slots,
    uniforms: shared,
    tables,
    compaction,
  });
  const attachDust = () => {
    shared.uDustTexture.value = createVoxelTexture(4, new Uint8Array(64));
    slots.setDustTexture(shared.uDustTexture.value);
  };
  return {
    ...fake, prepass, catalog, shared, slots, refill: slots.refill, compaction, attachDust,
  };
}

describe('construction', () => {
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

  // The compaction kernel binds both from its first frame.
  it('points the refill slots at a stamp per star and one table of slots then worklist', () => {
    const { prepass, refill } = makePrepass();
    expect((refill.stamps.value as StorageBufferAttribute).count).toBe(COUNT);
    expect((refill.table.value as StorageBufferAttribute).count)
      .toBe(COUNT + refillWorklistLength(COUNT));
    expect(refill.arm.value).toBe(0);
    prepass.dispose();
  });

  it('the whole fill dispatches one thread per star', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(computes[0].count).toBe(COUNT);
    expect(computes[0].name).toBe('extinction-prepass-fill');
  });
});

describe('the worklist refill', () => {
  // The first fill is whole: until it lands every consumer runs its own
  // in-vertex march, which is dearer than the dispatch it waits on.
  it('fills whole on the first frame; a request then arms the compaction and marches nothing yet', () => {
    const { prepass, dispatched, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(dispatched).toEqual([COUNT]);
    expect(refill.arm.value).toBe(0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(dispatched).toEqual([COUNT]);
    expect(refill.arm.value).toBe(1);
    expect(refill.cameraGeneration.value).toBe(2);
  });

  // The kernel marches the class the compaction built LAST frame, at the
  // workgroup count its finish kernel wrote — nothing crosses to the CPU.
  // The arm stays up while classes are still to build and drops on the frame
  // the last one marches.
  it('then marches one class a frame at the compaction\'s indirect count, and parks', () => {
    const {
      prepass, computes, dispatched, dispatchedQuarter, refill, compaction, attachDust,
    } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    const quarters: number[] = [];
    const arms: number[] = [];
    for (let frame = 0; frame < REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
      quarters.push(refill.quarter.value);
      arms.push(refill.arm.value);
    }
    expect(dispatched).toEqual([COUNT, undefined, undefined, undefined, undefined]);
    for (const k of computes.slice(1)) {
      expect(k.name).toBe('extinction-prepass-refill');
      expect(k.dispatchSize).toBe(compaction.refillDispatch);
      // A numeric count would make three prepend an early return on it.
      expect(k.count).toBeNull();
    }
    // The class left behind is the one the compaction builds and sizes now,
    // and the prepass marches next frame.
    expect(quarters).toEqual([1, 2, 3, 0]);
    expect(arms).toEqual([1, 1, 1, 0]);
    // Consume, then produce, in one update(): each dispatch carried the class
    // the compaction built LAST frame, not the one the same call goes on to
    // arm. The uniform holds the first value only across that one line.
    expect(dispatchedQuarter.slice(1)).toEqual([0, 1, 2, 3]);
    for (let frame = 0; frame < 5; frame++) prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(1 + REFILL_SLICES);
  });

  it('keeps the compaction armed and a quarter marching under a request every frame', () => {
    const { prepass, computes, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let frame = 1; frame <= 2 * REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2 * frame, 0, 0);
      expect(refill.arm.value).toBe(1);
    }
    expect(computes).toHaveLength(2 * REFILL_SLICES);
    expect(refill.cameraGeneration.value).toBe(1 + 2 * REFILL_SLICES);
  });

  it('refills the whole catalogue before the parity march and leaves nothing owed', () => {
    const { prepass, dispatched, reads, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    dispatched.length = 0;
    // The reference march wants a render target the fake has no answer for;
    // the dispatch that precedes it is what a bit compare rests on.
    void prepass.verifyParity().catch(() => {});
    expect(dispatched).toEqual([COUNT]);
    expect(refill.arm.value).toBe(0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });
});

describe('only what is in frame', () => {
  // The first fill records the view, so a still view the next frame is free.
  it('a still view at a parked camera dispatches nothing', () => {
    const { prepass, dispatched, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(0, 0, 0, viewAt(0));
    expect(dispatched).toEqual([COUNT]);
    expect(refill.arm.value).toBe(0);
  });

  // A turn is a request like a displacement: the compaction lists what it
  // newly exposes, and the quarters follow.
  it('a turned view arms the compaction and marches the quarters, one a frame', () => {
    const { prepass, dispatched, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(0, 0, 0, viewAt(0.1));
    expect(refill.arm.value).toBe(1);
    // A turn bumps no generation: the stamps decide what is new.
    expect(refill.cameraGeneration.value).toBe(1);
    for (let frame = 0; frame < REFILL_SLICES; frame++) prepass.update(0, 0, 0, viewAt(0.1));
    expect(dispatched).toEqual([COUNT, undefined, undefined, undefined, undefined]);
  });

  it('a translation and a turn on the same frame are one request', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0, viewAt(0.1));
    for (let frame = 0; frame < REFILL_SLICES + 2; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0, viewAt(0.1));
    }
    expect(computes).toHaveLength(1 + REFILL_SLICES);
  });

  it('a turning view stages no mirror until every quarter has marched', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0, viewAt(0));
    prepass.update(0, 0, 0, viewAt(0.1));
    prepass.warmAvReadback();
    expect(reads).toHaveLength(0);
    for (let frame = 0; frame < REFILL_SLICES; frame++) {
      prepass.update(0, 0, 0, viewAt(0.1));
    }
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });

  // see ./refill/README.md#counting-the-in-frame-population
  it('counts the in-frame population at the view it last saw', () => {
    const { prepass, shared, attachDust } = makePrepass();
    attachDust();
    expect(prepass.countInFrame()).toBeNull();
    prepass.update(0, 0, 0, viewAt(0));
    const view = composeViewProjectionAbs(viewAt(0).camera, new Vector3(), new Matrix4());
    const viewport = shared.uViewport.value;
    expect(prepass.countInFrame())
      .toBe(countInFrameAbs(diagonal(COUNT), COUNT, view, viewport.x, viewport.y, -1));
    prepass.update(0, 0, 0, viewAt(Math.PI));
    const turned = composeViewProjectionAbs(viewAt(Math.PI).camera, new Vector3(), new Matrix4());
    expect(prepass.countInFrame())
      .toBe(countInFrameAbs(diagonal(COUNT), COUNT, turned, viewport.x, viewport.y, -1));
    expect(prepass.countInFrame()).not.toBe(0);
  });

  // see ./refill/README.md#the-generation-stamp
  it('a camera creeping under epsilon per frame keeps recomputing', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let frame = 1; frame <= 40; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 0.6 * frame, 0, 0);
    }
    // 40 frames × 0.6 ε is 24 ε of travel: a bump every second frame, each
    // owing the quarters again, so the kernel ran on nearly every frame.
    expect(computes.length).toBeGreaterThan(1 + 2 * REFILL_SLICES);
  });
});

describe('the dispatch order', () => {
  const SIDE = 8;
  const LATTICE_COUNT = SIDE ** 3;

  /** The tables the kernels pair, read back off the dispose registry —
   *  nothing else exposes a buffer no geometry owns. */
  function tables(count: number, positions: Float32Array) {
    const { prepass, released, attachDust } = makePrepass(count, positions);
    attachDust();
    prepass.update(0, 0, 0);
    prepass.dispose();
    const [starOfSlot, refillTable] = permutations(released);
    return {
      slotPositions: released.find((a) => a.itemSize === 4)!.array as Float32Array,
      starOfSlot,
      // Star → slot leads the fused table; the worklist follows it.
      slotOfStar: refillTable.subarray(0, count),
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

  // The refill kernel is handed a star and has to find it in the
  // slot-indexed table, so the slot table is the order table's inverse.
  it('pairs the slot table as the inverse of the order table', () => {
    const { starOfSlot, slotOfStar } = tables(LATTICE_COUNT, scrambledLattice(SIDE, 331));
    expect(slotOfStar).toHaveLength(LATTICE_COUNT);
    for (let slot = 0; slot < LATTICE_COUNT; slot++) expect(slotOfStar[starOfSlot[slot]]).toBe(slot);
  });
});

describe('the dispatch order under a streaming catalogue', () => {
  const SIDE = 8;
  const LATTICE_COUNT = SIDE ** 3;
  const LOADED = LATTICE_COUNT / 4;

  /** The lattice as attach sees it mid-load: the undecoded tail at zero. */
  function streaming() {
    const full = scrambledLattice(SIDE, 331);
    const positions = full.slice();
    positions.fill(0, LOADED * 3);
    return { full, positions, ...makePrepass(LATTICE_COUNT, positions, LOADED) };
  }

  function orderOf(released: readonly BufferAttribute[]) {
    const [starOfSlot, refillTable] = permutations(released);
    return {
      starOfSlot: Array.from(starOfSlot),
      slotOfStar: Array.from(refillTable.subarray(0, LATTICE_COUNT)),
      slotPositions: released.find((a) => a.itemSize === 4)!.array as Float32Array,
    };
  }

  const sortedOver = (positions: Float32Array) =>
    Array.from(mortonDispatchOrder(positions, LATTICE_COUNT));

  it('re-sorts over the whole catalogue on the chunk that completes it', () => {
    const { full, positions, prepass, catalog, released, attachDust } = streaming();
    const attachOrder = sortedOver(positions);
    attachDust();
    prepass.update(0, 0, 0);
    const half = LATTICE_COUNT / 2;
    positions.set(full.subarray(LOADED * 3, half * 3), LOADED * 3);
    catalog.loadedCount = half;
    prepass.refreshPositions();
    positions.set(full);
    catalog.loadedCount = LATTICE_COUNT;
    prepass.refreshPositions();
    prepass.dispose();
    const { starOfSlot, slotOfStar, slotPositions } = orderOf(released);
    expect(sortedOver(full)).not.toEqual(attachOrder);
    expect(starOfSlot).toEqual(sortedOver(full));
    for (let slot = 0; slot < LATTICE_COUNT; slot++) {
      const star = starOfSlot[slot];
      expect(slotOfStar[star]).toBe(slot);
      expect(slotPositions[slot * 4]).toBe(full[star * 3]);
    }
  });

  it('keeps the attach-time order while the catalogue is still landing', () => {
    const { full, positions, prepass, catalog, released, attachDust } = streaming();
    const attachOrder = sortedOver(positions);
    attachDust();
    prepass.update(0, 0, 0);
    positions.set(full.subarray(0, (LATTICE_COUNT - 1) * 3));
    catalog.loadedCount = LATTICE_COUNT - 1;
    prepass.refreshPositions();
    prepass.dispose();
    expect(orderOf(released).starOfSlot).toEqual(attachOrder);
  });

  it('sorts once: neither a complete attach nor a later epoch refresh re-sorts', () => {
    const positions = scrambledLattice(SIDE, 331);
    const attachOrder = sortedOver(positions);
    const { prepass, released, attachDust } = makePrepass(LATTICE_COUNT, positions);
    attachDust();
    prepass.update(0, 0, 0);
    positions.reverse();
    prepass.refreshPositions();
    prepass.dispose();
    expect(orderOf(released).starOfSlot).toEqual(attachOrder);

    const late = streaming();
    late.attachDust();
    late.positions.set(late.full);
    late.catalog.loadedCount = LATTICE_COUNT;
    late.prepass.refreshPositions();
    const resorted = sortedOver(late.full);
    late.positions.reverse();
    late.prepass.refreshPositions();
    late.prepass.dispose();
    expect(orderOf(late.released).starOfSlot).toEqual(resorted);
  });

  it('parks a refill in flight and re-requests', () => {
    const { full, positions, prepass, catalog, computes, refill, attachDust } = streaming();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(refill.arm.value).toBe(1);
    const generation = refill.cameraGeneration.value;
    positions.set(full);
    catalog.loadedCount = LATTICE_COUNT;
    prepass.refreshPositions();
    expect(refill.arm.value).toBe(0);
    const held = computes.length;
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(held);
    expect(refill.cameraGeneration.value).toBe(generation + 1);
    expect(refill.arm.value).toBe(1);
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

  it('an idle camera is free; a move past epsilon requests, and the next frame marches', () => {
    const { prepass, computes, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 0.5, 0, 0);
    expect(computes).toHaveLength(1);
    expect(refill.arm.value).toBe(0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(refill.arm.value).toBe(1);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(2);
  });

  it('an idle camera stays free once the quarters the move owed have marched', () => {
    const { prepass, computes, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    moveAndSettle(prepass, RECOMPUTE_EPSILON_PC * 2);
    const settled = computes.length;
    expect(settled).toBe(1 + REFILL_SLICES);
    for (let frame = 0; frame < 10; frame++) prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(settled);
  });

  // A compute pass binds no render target — pin that nothing is bound at
  // all.
  it('never touches the render-target binding', () => {
    const { prepass, setRenderTarget, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(setRenderTarget).not.toHaveBeenCalled();
  });

  it('markDirty requests without any camera motion — a voxel chunk landed', () => {
    const { prepass, computes, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.markDirty();
    prepass.update(0, 0, 0);
    expect(refill.arm.value).toBe(1);
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(2);
  });

  // Left armed, the compaction would rebuild a list nothing marches, every frame.
  it('the A/B switch disarms the compaction and marches nothing', () => {
    const { prepass, computes, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(refill.arm.value).toBe(1);
    prepass.setEnabled(false);
    expect(refill.arm.value).toBe(0);
    const held = computes.length;
    for (let frame = 0; frame < 10; frame++) prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(held);
    expect(refill.arm.value).toBe(0);
  });

  // Disarming leaves the compaction with a class built and unmarched. Park
  // the cursor with it — or the re-enabling frame dispatches over that stale
  // sub-list, at the count the finish kernel has republished ever since —
  // and re-request, so the classes the switch abandoned are not lost at a
  // camera that never moves again.
  it('the A/B switch parks the cursor and re-requests rather than resuming', () => {
    const { prepass, computes, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(refill.arm.value).toBe(1);
    const generation = refill.cameraGeneration.value;
    prepass.setEnabled(false);
    prepass.setEnabled(true);
    const held = computes.length;
    // Same camera: without the park this frame would march the class built
    // before the switch.
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(computes).toHaveLength(held);
    expect(refill.cameraGeneration.value).toBe(generation + 1);
    expect(refill.arm.value).toBe(1);
    for (let frame = 0; frame < REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    }
    expect(computes).toHaveLength(held + REFILL_SLICES);
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
    const { prepass, computes, shared, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1);
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1);
    shared[key].value += 1;
    // The request bumps the generation, so the compaction lists everything
    // in frame and the quarters refill it over the next REFILL_SLICES frames
    // — a bound that landed in one quarter and nowhere else would leave most
    // of the buffer answering to the old aperture.
    prepass.update(0, 0, 0);
    expect(refill.arm.value).toBe(1);
    expect(refill.cameraGeneration.value).toBe(2);
    for (let frame = 0; frame < REFILL_SLICES; frame++) prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1 + REFILL_SLICES);
    // And settles again: a watch that re-fired every frame would cost the
    // whole march per frame at a parked camera.
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(1 + REFILL_SLICES);
    expect(refill.arm.value).toBe(0);
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
});

describe('the epoch refresh', () => {
  // StarFrame rewrites catalog.positions in place every bucket the model
  // clock crosses. The table packed at attach is a copy, so without this
  // the march — and the gate over it — stay at the attach epoch.
  it('re-packs from the array the space-motion pass rewrote, and requests a refill', () => {
    const positions = diagonal(COUNT);
    const { prepass, computes, released, refill, attachDust } = makePrepass(COUNT, positions);
    attachDust();
    prepass.update(0, 0, 0);
    positions[0] = 4321;
    prepass.refreshPositions();
    prepass.update(0, 0, 0);
    expect(refill.arm.value).toBe(1);
    prepass.update(0, 0, 0);
    expect(computes).toHaveLength(2);
    prepass.dispose();
    const slotPositions = released.find((a) => a.itemSize === 4)!.array as Float32Array;
    const [starOfSlot] = permutations(released);
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

  // The read can outlive the buffer's contents, so the generation counter
  // is what invalidates it (README.md#cold-reads--the-one-behaviour-that-is-not-parity).
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

  // A warp or a focus lerp requests every frame, so a copy issued then is
  // superseded before it lands — the pick reads null and errs pickable
  // across that stretch whether or not the copy was spent.
  it('spends nothing while the camera is still requesting every frame', () => {
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

  // A mirror taken with a quarter still owed is superseded by that quarter
  // before the dwell that wanted it can read a byte, so the flight has to
  // close first.
  it('warms on the frame the last owed quarter marches, not before', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let frame = 1; frame <= REFILL_SLICES; frame++) {
      prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
      prepass.warmAvReadback();
      expect(reads, `frame ${frame} of the flight`).toHaveLength(0);
    }
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    prepass.warmAvReadback();
    expect(reads).toHaveLength(1);
  });

  // A dust chunk landing on a parked camera requests too, and once its
  // quarters have marched that IS a frame a pick can be staged for — gating
  // on the recompute rather than on the flight would swallow it.
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

  it('hands the refill slots back to their placeholders, disarmed', () => {
    const { prepass, refill, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    const stamps = refill.stamps.value;
    const table = refill.table.value;
    prepass.dispose();
    expect(refill.stamps.value).not.toBe(stamps);
    expect(refill.table.value).not.toBe(table);
    expect((refill.stamps.value as StorageBufferAttribute).count).toBe(1);
    expect(refill.arm.value).toBe(0);
  });

  // None of the five sits in a geometry, so nothing but this call frees
  // them (../tsl/README.md#storage-attributes).
  it('frees all five storage buffers through the renderer registry', () => {
    const { prepass, slots, released, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const av = slots.av.value as StorageBufferAttribute;
    prepass.dispose();
    expect(released).toContain(av);
    expect(released).toHaveLength(5);
    const positions = released.find((a) => a.itemSize === 4)!;
    expect(positions.count).toBe(COUNT);
    const uints = released.filter((a) => a.array instanceof Uint32Array);
    expect(uints.map((u) => u.count).sort((a, b) => a - b))
      .toEqual([COUNT, COUNT, COUNT + refillWorklistLength(COUNT)].sort((a, b) => a - b));
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
