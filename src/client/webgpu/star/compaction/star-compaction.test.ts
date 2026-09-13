import { describe, expect, it } from 'vitest';
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
    expect(Array.from(compaction.args.array)).toEqual([6, 0, 0, 0, 0, 6, 0, 0, 0, 0]);
  });
});

describe('StarCompaction dispatch', () => {
  // One compute pass, one submit: the reset's stores are visible to the
  // kernel's atomics, and every draw of the render submit reads the result.
  it('runs the reset then the kernel in a single compute call', () => {
    const { compaction, dispatches } = make();
    compaction.dispatch();
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
    compaction.dispatch();
    compaction.dispatch();
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1]).toBe(dispatches[0]);
  });
});

describe('StarCompaction dispose', () => {
  it('releases both buffers through the renderer registry and disposes both kernels', () => {
    const { compaction, released, dispatches } = make();
    compaction.dispatch();
    const disposed: string[] = [];
    for (const k of dispatches[0] as ComputeNode[]) {
      k.addEventListener('dispose', () => disposed.push(k.name));
    }
    compaction.dispose();
    expect(released).toEqual([compaction.survivors, compaction.args]);
    expect(disposed.sort()).toEqual(['star-compaction', 'star-compaction-reset']);
    compaction.dispatch();
    expect(dispatches).toHaveLength(1);
  });
});
