import { describe, expect, it } from 'vitest';
import { R_SUN_PC } from '../../../src/client/util/astronomy-constants';
import {
  orbitChainExemption,
  physicalOverlaps,
  type OverlapRecord,
} from './overlap-gate-pure';

function star(x: number, physicalRadius = 1): OverlapRecord {
  return { x, y: 10, z: 0, physicalRadius };
}

const none = () => false;

describe('physicalOverlaps', () => {
  it('flags two stars whose discs intersect', () => {
    expect(physicalOverlaps([star(0), star(1.5 * R_SUN_PC)], none)).toEqual([[0, 1]]);
  });

  it('flags a bit-identical pair', () => {
    expect(physicalOverlaps([star(5), star(5)], none)).toEqual([[0, 1]]);
  });

  it('passes stars just clear of each other', () => {
    expect(physicalOverlaps([star(0), star(2.01 * R_SUN_PC)], none)).toEqual([]);
  });

  it('measures reach from the sum of both radii', () => {
    expect(physicalOverlaps([star(0, 100), star(100.5 * R_SUN_PC, 1)], none))
      .toEqual([[0, 1]]);
  });

  it('returns index pairs in record order whatever the sweep order', () => {
    expect(physicalOverlaps([star(3 * R_SUN_PC), star(2.5 * R_SUN_PC)], none))
      .toEqual([[0, 1]]);
  });
});

describe('orbitChainExemption', () => {
  it('exempts a collocated pair a renderable orbit animates apart', () => {
    expect(physicalOverlaps([star(5), star(5)], orbitChainExemption([[1, 0]])))
      .toEqual([]);
  });

  it('exempts only the orbit pair, not a third star on the same spot', () => {
    expect(physicalOverlaps([star(5), star(5), star(5)], orbitChainExemption([[0, 1]])))
      .toEqual([[0, 2], [1, 2]]);
  });

  it('exempts a chain of orbits, ancestor against descendant', () => {
    expect(physicalOverlaps([star(5), star(5), star(5)], orbitChainExemption([[0, 1], [1, 2]])))
      .toEqual([]);
  });

  it('flags two siblings of one primary on one spot', () => {
    expect(physicalOverlaps([star(5), star(5), star(5)], orbitChainExemption([[0, 1], [0, 2]])))
      .toEqual([[1, 2]]);
  });

  it('flags members of two separate hierarchies on one spot', () => {
    const records = [star(5), star(5), star(5), star(5)];
    expect(physicalOverlaps(records, orbitChainExemption([[0, 1], [2, 3]])))
      .toEqual([[0, 2], [0, 3], [1, 2], [1, 3]]);
  });
});
