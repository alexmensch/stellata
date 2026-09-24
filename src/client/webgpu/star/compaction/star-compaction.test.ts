import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ComputeNode, WebGPURenderer } from 'three/webgpu';
import { makeHdrEmitterUniforms } from '../../../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../../../frame/shared-uniforms';
import { makeColorLutTexture } from '../../../star-pipeline/blackbody-lut';
import { ExtinctionNodes } from '../../extinction/extinction-nodes';
import { REFILL_BUCKETS } from '../../extinction/refill/refill-buckets-pure';
import { buildSharedUniformNodes } from '../../tsl/shared-uniform-nodes';
import { makeFakeStarRenderer, makeStarLayerSources } from '../star-sources-mock';
import { StarTables } from '../star-tables';
import type { StarTslDeps } from '../star-vertex-tsl';
import { WEBGPU_CORE_STORAGE_BUFFERS_PER_STAGE } from '../../tsl/storage-attribute';
import { STAR_TIERS } from './compaction-pure';
import { STAR_COMPACTION_KERNEL_STORAGE_BUFFERS, StarCompaction } from './star-compaction';

const COUNT = 6;

function make() {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const extinction = new ExtinctionNodes();
  const deps: StarTslDeps = {
    u: buildSharedUniformNodes(shared).nodes,
    tables: new StarTables(makeStarLayerSources(COUNT).sources),
    lut: makeColorLutTexture(),
    dust: extinction.dust,
    av: extinction.av,
  };
  const fake = makeFakeStarRenderer();
  return {
    ...fake,
    extinction,
    compaction: new StarCompaction(
      fake.renderer as unknown as WebGPURenderer, deps, 6, extinction.refill),
  };
}

describe('StarCompaction buffers', () => {
  // The kernel sits ON the core ceiling, so a ninth binding is a boot
  // failure on a device that grants only what WebGPU guarantees. Adding one
  // means folding a counter or a table, not raising this number.
  it('binds the eight storage buffers WebGPU guarantees a stage, and no more', () => {
    expect(STAR_COMPACTION_KERNEL_STORAGE_BUFFERS).toBe(8);
    expect(WEBGPU_CORE_STORAGE_BUFFERS_PER_STAGE).toBe(8);
    expect(STAR_COMPACTION_KERNEL_STORAGE_BUFFERS)
      .toBeLessThanOrEqual(WEBGPU_CORE_STORAGE_BUFFERS_PER_STAGE);
  });

  it('one survivor slot per star per tier, uint32', () => {
    const { compaction } = make();
    expect(compaction.survivors.count).toBe(STAR_TIERS.length * COUNT);
    expect(compaction.survivors.array).toBeInstanceOf(Uint32Array);
    expect(compaction.survivors.isStorageBufferAttribute).toBe(true);
  });

  it('the args buffer is indirect-capable and starts every slot and counter at zero', () => {
    const { compaction } = make();
    expect(compaction.args.isIndirectStorageBufferAttribute).toBe(true);
    expect(Array.from(compaction.args.array.subarray(0, 11)))
      .toEqual([6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0]);
    expect(compaction.args.array.subarray(11).every((v) => v === 0)).toBe(true);
  });

  it('the refill dispatch is indirect-capable and starts at zero workgroups, zero listed', () => {
    const { compaction } = make();
    expect(compaction.refillDispatch.isIndirectStorageBufferAttribute).toBe(true);
    expect(Array.from(compaction.refillDispatch.array.subarray(0, 4))).toEqual([0, 1, 1, 0]);
    expect(compaction.refillDispatch.array.subarray(4).every((v) => v === 0)).toBe(true);
  });

  // The refill kernel bounds itself by the listed length in that buffer, so
  // it gets a read-only view distinct from the finish kernel's writer.
  it('exposes a read-only view of the refill dispatch over the same attribute', () => {
    const { compaction } = make();
    expect(compaction.refillDispatchNode.value).toBe(compaction.refillDispatch);
    expect(compaction.refillDispatchNode.access).toBe('readOnly');
  });
});

const camera = () => {
  const c = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
  c.position.set(1, 2, 3);
  c.lookAt(0, 0, 0);
  return c;
};

describe('StarCompaction dispatch', () => {
  // One compute pass, one submit: the reset's stores are visible to the
  // kernel's atomics, the kernel's adds to the finish kernel's loads, and
  // every draw of the render submit reads the result.
  it('runs the reset, the kernel, then the two scan kernels in a single compute call', () => {
    const { compaction, dispatches, extinction } = make();
    extinction.refill.arm.value = 1;
    compaction.dispatch(camera());
    expect(dispatches).toHaveLength(1);
    const [reset, kernel, copyCounts, finish] = dispatches[0] as ComputeNode[];
    expect(dispatches[0]).toHaveLength(4);
    expect(reset.count).toBe(REFILL_BUCKETS);
    expect(kernel.count).toBe(COUNT);
    expect(copyCounts.count).toBe(REFILL_BUCKETS);
    expect(finish.count).toBe(REFILL_BUCKETS);
    expect(reset.name).toBe('star-compaction-reset');
    expect(kernel.name).toBe('star-compaction');
    expect(finish.name).toBe('star-compaction-refill-dispatch');
  });

  // The scan's output is read only by the refill kernel, which the prepass
  // dispatches only on the frame after a class was built — and a class is
  // built only under the arm. So an unarmed frame would scan counters
  // nothing appended into and write a dispatch nothing reads.
  it('leaves both scan kernels out of an unarmed frame', () => {
    const { compaction, dispatches, extinction } = make();
    extinction.refill.arm.value = 0;
    compaction.dispatch(camera());
    const kernels = dispatches[0] as ComputeNode[];
    expect(kernels.map((k) => k.name)).toEqual(['star-compaction-reset', 'star-compaction']);
  });

  it('picks the set by the arm the prepass left up, frame by frame', () => {
    const { compaction, dispatches, extinction } = make();
    const c = camera();
    extinction.refill.arm.value = 1;
    compaction.dispatch(c);
    extinction.refill.arm.value = 0;
    compaction.dispatch(c);
    extinction.refill.arm.value = 1;
    compaction.dispatch(c);
    expect(dispatches.map((d) => (d as ComputeNode[]).length)).toEqual([4, 2, 4]);
  });

  // The kernels are built once: a frame re-dispatches the same array rather
  // than rebuilding two ComputeNodes on the hot path.
  it('dispatches once per call, every frame, over the same kernels', () => {
    const { compaction, dispatches } = make();
    const c = camera();
    compaction.dispatch(c);
    compaction.dispatch(c);
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1]).toBe(dispatches[0]);
  });

  // The controls mutate position and quaternion without propagating them;
  // the kernel must test against where the camera IS this frame, not where
  // the last render left its matrices.
  it('refreshes the camera matrices and hands the kernel projection × view', () => {
    const { compaction } = make();
    const c = camera();
    compaction.dispatch(c);
    const expected = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    expect(compaction.viewProjectionMatrix.elements).toEqual(expected.elements);

    c.position.set(-4, 0, 9);
    const stale = compaction.viewProjectionMatrix;
    compaction.dispatch(c);
    const moved = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    expect(compaction.viewProjectionMatrix.elements).toEqual(moved.elements);
    expect(compaction.viewProjectionMatrix.elements).not.toEqual(stale.elements);
  });

  it('hands back a copy, so a reader cannot retarget the cull', () => {
    const { compaction } = make();
    compaction.dispatch(camera());
    const taken = compaction.viewProjectionMatrix;
    taken.identity();
    expect(compaction.viewProjectionMatrix.elements).not.toEqual(taken.elements);
  });
});

// The counter feeds no draw, so it must not run on frames nobody asked for
// a count on (README.md#reading-the-counts-back).
describe('the prefilter counter is armed only across its readback', () => {
  it('waits for a dispatch to count into', async () => {
    const { compaction, dispatches } = make();
    const pending = compaction.readSurvivorCounts();
    expect(await Promise.race([pending, Promise.resolve('unsettled')])).toBe('unsettled');
    expect(dispatches).toHaveLength(0);
    compaction.dispatch(camera());
    expect(await pending).toEqual({ glow: 0, disc: 0, prefilter: 0 });
  });

  it('releases a waiting readback on dispose rather than hanging for the boot', async () => {
    const { compaction } = make();
    const pending = compaction.readSurvivorCounts();
    compaction.dispose();
    expect(await pending).toBeNull();
  });
});

describe('StarCompaction dispose', () => {
  it('releases every buffer through the renderer registry and disposes all four kernels', () => {
    const { compaction, released, dispatches, extinction } = make();
    extinction.refill.arm.value = 1;
    compaction.dispatch(camera());
    const disposed: string[] = [];
    for (const k of dispatches[0] as ComputeNode[]) {
      k.addEventListener('dispose', () => disposed.push(k.name));
    }
    compaction.dispose();
    expect(released).toEqual([compaction.survivors, compaction.args, compaction.refillDispatch]);
    expect(disposed.sort()).toEqual([
      'star-compaction', 'star-compaction-refill-counts',
      'star-compaction-refill-dispatch', 'star-compaction-reset',
    ]);
    compaction.dispatch(camera());
    expect(dispatches).toHaveLength(1);
  });
});
