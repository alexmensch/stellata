import { describe, expect, it } from 'vitest';
import { IndirectStorageBufferAttribute } from 'three/webgpu';
import { STAR_TIER_DISC, STAR_TIER_GLOW, initialIndirectArgs, tierArgsOffsetBytes } from './compaction/compaction-pure';
import { STAR_QUAD_INDEX_COUNT, buildStarGeometries } from './star-geometry';

const build = (count = 6) => {
  const args = new IndirectStorageBufferAttribute(initialIndirectArgs(STAR_QUAD_INDEX_COUNT), 1);
  return { args, ...buildStarGeometries(count, 1e5, args) };
};

describe('buildStarGeometries', () => {
  it('carries the corner alone — every per-instance field is a storage table', () => {
    const { glow, disc } = build();
    expect(Object.keys(glow.attributes)).toEqual(['aCorner']);
    expect(Object.keys(disc.attributes)).toEqual(['aCorner']);
    expect(STAR_QUAD_INDEX_COUNT).toBe(6);
  });

  it('both tiers share the corner and index buffers by reference', () => {
    const { glow, disc } = build();
    expect(disc.getAttribute('aCorner')).toBe(glow.getAttribute('aCorner'));
    expect(disc.getIndex()).toBe(glow.getIndex());
    expect(glow.getIndex()?.count).toBe(STAR_QUAD_INDEX_COUNT);
  });

  it('each tier draws indirect off its own slot of the one args buffer', () => {
    const { args, glow, disc } = build();
    expect(glow.indirect).toBe(args);
    expect(disc.indirect).toBe(args);
    expect(glow.indirectOffset).toBe(tierArgsOffsetBytes(STAR_TIER_GLOW));
    expect(disc.indirectOffset).toBe(tierArgsOffsetBytes(STAR_TIER_DISC));
    expect(disc.indirectOffset).toBe(20);
  });

  // three returns null draw parameters for an instanceCount of 0 and never
  // reaches the indirect draw, so the nominal count has to stay positive.
  it('keeps a positive nominal instance count and the catalogue bound', () => {
    const { glow, disc } = build(6);
    expect(glow.instanceCount).toBe(6);
    expect(disc.instanceCount).toBe(6);
    expect(glow.boundingSphere?.radius).toBe(1e5);
  });
});
