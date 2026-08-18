import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StarPipeline } from '../star-pipeline/star-pipeline';
import { makeStarPipelineOptions } from '../star-pipeline/star-pipeline-mock';
import { planVec4Packing } from './attribute-packing-pure';
import {
  MAX_VERTEX_BUFFERS,
  STAR_DYNAMIC_SCALARS,
  STAR_PACK_PREFIX_DYNAMIC,
  STAR_PACK_PREFIX_STATIC,
  STAR_STATIC_SCALARS,
  STAR_UNPACKED_ATTRIBUTES,
} from './star-attribute-roster';

function starGeometryAttributes() {
  const { geometry } = new StarPipeline(makeStarPipelineOptions());
  return Object.entries(geometry.attributes).map(([name, attr]) => ({
    name,
    itemSize: attr.itemSize,
    dynamic: ('usage' in attr ? attr.usage : attr.data.usage) === THREE.DynamicDrawUsage,
  }));
}

const sorted = (names: readonly string[]) => [...names].sort();

describe('star attribute roster', () => {
  it('is the live WebGL geometry, partitioned by width and upload cadence', () => {
    const attrs = starGeometryAttributes();
    const scalars = attrs.filter((a) => a.itemSize === 1);

    expect(sorted(scalars.filter((a) => !a.dynamic).map((a) => a.name)))
      .toEqual(sorted(STAR_STATIC_SCALARS));
    expect(sorted(scalars.filter((a) => a.dynamic).map((a) => a.name)))
      .toEqual(sorted(STAR_DYNAMIC_SCALARS));
    expect(sorted(attrs.filter((a) => a.itemSize > 1).map((a) => a.name)))
      .toEqual(sorted(STAR_UNPACKED_ATTRIBUTES));
  });

  it('the unported geometry is 15 vertex buffers — 7 over the WebGPU limit', () => {
    expect(starGeometryAttributes()).toHaveLength(15);
    expect(15 - MAX_VERTEX_BUFFERS).toBe(7);
  });

  it('packing by cadence lands on 7 buffers, one under the limit', () => {
    const staticPlan = planVec4Packing(STAR_STATIC_SCALARS, STAR_PACK_PREFIX_STATIC);
    const dynamicPlan = planVec4Packing(STAR_DYNAMIC_SCALARS, STAR_PACK_PREFIX_DYNAMIC);
    expect(staticPlan.bufferCount).toBe(3);
    expect(dynamicPlan.bufferCount).toBe(1);

    const total = staticPlan.bufferCount + dynamicPlan.bufferCount
      + STAR_UNPACKED_ATTRIBUTES.length;
    expect(total).toBe(7);
    expect(MAX_VERTEX_BUFFERS - total).toBe(1);
  });

  it('the two plans cannot collide on a buffer name', () => {
    expect(STAR_PACK_PREFIX_STATIC).not.toBe(STAR_PACK_PREFIX_DYNAMIC);
  });
});
