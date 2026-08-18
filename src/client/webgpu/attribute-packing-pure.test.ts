import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK_PREFIX,
  packVec4Buffers,
  packedAccess,
  packedBufferName,
  planVec4Packing,
} from './attribute-packing-pure';

const STAR_ATTRS_14 = [
  'iAbsMag', 'iCi', 'iDistSol', 'iSpectClass', 'iLumClass', 'iLogRadius',
  'iTeffApsis', 'iPeriodDays', 'iAmplitudeMag', 'iPulseRho', 'iCiSwing',
  'iSuppress', 'iPosX', 'iPosY',
] as const;

describe('planVec4Packing', () => {
  it("the star pair's 14 scalars land in 4 buffers — under the 8-buffer device limit with aCorner + iPosition", () => {
    const plan = planVec4Packing(STAR_ATTRS_14);
    expect(plan.bufferCount).toBe(4);
  });

  it('assigns buffer/component in declaration order', () => {
    const plan = planVec4Packing(['a', 'b', 'c', 'd', 'e']);
    expect(plan.bufferCount).toBe(2);
    expect(plan.slots.a).toEqual({ buffer: 0, component: 0 });
    expect(plan.slots.d).toEqual({ buffer: 0, component: 3 });
    expect(plan.slots.e).toEqual({ buffer: 1, component: 0 });
  });

  it('rejects a duplicate name', () => {
    expect(() => planVec4Packing(['a', 'b', 'a'])).toThrow(/duplicate/);
  });

  it('treats an Object.prototype key as an ordinary name', () => {
    const plan = planVec4Packing(['toString', 'constructor']);
    expect(plan.slots.toString).toEqual({ buffer: 0, component: 0 });
    expect(packedAccess(plan, 'constructor').component).toBe('y');
    expect(() => packedAccess(plan, 'valueOf')).toThrow(/not in the pack plan/);
  });
});

describe('packedBufferName / packedAccess', () => {
  it('names buffers from the plan prefix and maps components to swizzles in order', () => {
    const plan = planVec4Packing(['a', 'b', 'c', 'd', 'e']);
    expect(plan.prefix).toBe(DEFAULT_PACK_PREFIX);
    expect(packedBufferName(plan, 0)).toBe('iPack0');
    expect(packedAccess(plan, 'a')).toEqual({ buffer: 'iPack0', component: 'x' });
    expect(packedAccess(plan, 'b')).toEqual({ buffer: 'iPack0', component: 'y' });
    expect(packedAccess(plan, 'c')).toEqual({ buffer: 'iPack0', component: 'z' });
    expect(packedAccess(plan, 'd')).toEqual({ buffer: 'iPack0', component: 'w' });
    expect(packedAccess(plan, 'e')).toEqual({ buffer: 'iPack1', component: 'x' });
  });

  it('a custom prefix reaches both the buffer names and the accessors', () => {
    const plan = planVec4Packing(['a', 'b'], 'iDyn');
    expect(packedBufferName(plan, 0)).toBe('iDyn0');
    expect(packedAccess(plan, 'b')).toEqual({ buffer: 'iDyn0', component: 'y' });
  });

  it('throws on a name outside the plan', () => {
    expect(() => packedAccess(planVec4Packing(['a']), 'nope')).toThrow(/not in the pack plan/);
  });
});

describe('packVec4Buffers', () => {
  it('interleaves each scalar into its slot, zero-filling the tail', () => {
    const plan = planVec4Packing(['a', 'b', 'c', 'd', 'e']);
    const buffers = packVec4Buffers(plan, {
      a: [1, 10], b: [2, 20], c: [3, 30], d: [4, 40], e: [5, 50],
    }, 2);
    expect([...buffers[0]]).toEqual([1, 2, 3, 4, 10, 20, 30, 40]);
    expect([...buffers[1]]).toEqual([5, 0, 0, 0, 50, 0, 0, 0]);
  });

  it('rejects a missing source and a length mismatch', () => {
    const plan = planVec4Packing(['a', 'b']);
    expect(() => packVec4Buffers(plan, { a: [1] }, 1)).toThrow(/missing/);
    expect(() => packVec4Buffers(plan, { a: [1], b: [1, 2] }, 1)).toThrow(/1 instances/);
  });
});
