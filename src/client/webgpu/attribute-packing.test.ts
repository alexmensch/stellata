import { describe, expect, it } from 'vitest';
import { buildPackedAttributes, packedScalar } from './attribute-packing';
import { planVec4Packing } from './attribute-packing-pure';

describe('buildPackedAttributes', () => {
  it('yields one vec4 InstancedBufferAttribute per plan buffer, named by index', () => {
    const plan = planVec4Packing(['a', 'b', 'c', 'd', 'e']);
    const attrs = buildPackedAttributes(plan, {
      a: [1], b: [2], c: [3], d: [4], e: [5],
    }, 1);
    expect(attrs.map((x) => x.name)).toEqual(['iPack0', 'iPack1']);
    expect(attrs[0].attribute.itemSize).toBe(4);
    expect(attrs[0].attribute.count).toBe(1);
    expect([...(attrs[1].attribute.array as Float32Array)]).toEqual([5, 0, 0, 0]);
  });
});

describe('packedScalar', () => {
  it('resolves a scalar to a component of its packed buffer node', () => {
    const plan = planVec4Packing(['a', 'b']);
    expect(packedScalar(plan, 'b')).toBeDefined();
    expect(() => packedScalar(plan, 'nope')).toThrow(/not in the pack plan/);
  });
});
