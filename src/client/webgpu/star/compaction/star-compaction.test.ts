import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ComputeNode, WebGPURenderer } from 'three/webgpu';
import { makeHdrEmitterUniforms } from '../../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../../frame/shared-uniforms';
import { makeColorLutTexture } from '../../../star-pipeline/blackbody-lut';
import { ExtinctionNodes } from '../../extinction/extinction-nodes';
import { buildSharedUniformNodes } from '../../tsl/shared-uniform-nodes';
import { makeFakeStarRenderer, makeStarLayerSources } from '../star-sources-mock';
import { StarTables } from '../star-tables';
import type { StarTslDeps } from '../star-vertex-tsl';
import { STAR_TIERS } from './compaction-pure';
import { StarCompaction } from './star-compaction';

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
    compaction: new StarCompaction(fake.renderer as unknown as WebGPURenderer, deps, 6),
  };
}

describe('StarCompaction buffers', () => {
  it('one survivor slot per star per tier, uint32', () => {
    const { compaction } = make();
    expect(compaction.survivors.count).toBe(STAR_TIERS.length * COUNT);
    expect(compaction.survivors.array).toBeInstanceOf(Uint32Array);
    expect(compaction.survivors.isStorageBufferAttribute).toBe(true);
  });

  it('the args buffer is indirect-capable and starts every slot at zero instances', () => {
    const { compaction } = make();
    expect(compaction.args.isIndirectStorageBufferAttribute).toBe(true);
    expect(Array.from(compaction.args.array)).toEqual([6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0]);
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
  // kernel's atomics, and every draw of the render submit reads the result.
  it('runs the reset then the kernel in a single compute call', () => {
    const { compaction, dispatches } = make();
    compaction.dispatch(camera());
    expect(dispatches).toHaveLength(1);
    const [reset, kernel] = dispatches[0] as ComputeNode[];
    expect(reset.count).toBe(1);
    expect(kernel.count).toBe(COUNT);
    expect(reset.name).toBe('star-compaction-reset');
    expect(kernel.name).toBe('star-compaction');
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
// a count on (README.md § Reading the counts back).
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
  it('releases both buffers through the renderer registry and disposes both kernels', () => {
    const { compaction, released, dispatches } = make();
    compaction.dispatch(camera());
    const disposed: string[] = [];
    for (const k of dispatches[0] as ComputeNode[]) {
      k.addEventListener('dispose', () => disposed.push(k.name));
    }
    compaction.dispose();
    expect(released).toEqual([compaction.survivors, compaction.args]);
    expect(disposed.sort()).toEqual(['star-compaction', 'star-compaction-reset']);
    compaction.dispatch(camera());
    expect(dispatches).toHaveLength(1);
  });
});
