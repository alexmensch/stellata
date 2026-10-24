import { describe, expect, it } from 'vitest';
import { R_SUN_PC } from '../../../src/client/util/astronomy-constants';
import { physicalOverlaps, type OverlapRecord } from './overlap-gate-pure';

function star(x: number, physicalRadius = 1): OverlapRecord {
  return { x, y: 10, z: 0, physicalRadius };
}

describe('physicalOverlaps', () => {
  it('flags two stars whose discs intersect', () => {
    const a = star(0);
    const b = star(1.5 * R_SUN_PC);
    expect(physicalOverlaps([a, b], [])).toEqual([[a, b]]);
  });

  it('flags a bit-identical pair', () => {
    const a = star(5);
    const b = star(5);
    expect(physicalOverlaps([a, b], [])).toEqual([[a, b]]);
  });

  it('passes stars just clear of each other', () => {
    const a = star(0);
    const b = star(2.01 * R_SUN_PC);
    expect(physicalOverlaps([a, b], [])).toEqual([]);
  });

  it('measures reach from the sum of both radii', () => {
    const giant = star(0, 100);
    const dwarf = star(100.5 * R_SUN_PC, 1);
    expect(physicalOverlaps([giant, dwarf], [])).toEqual([[giant, dwarf]]);
  });

  it('exempts a collocated pair a renderable orbit animates apart', () => {
    const a = star(5);
    const b = star(5);
    expect(physicalOverlaps([a, b], [[b, a]])).toEqual([]);
  });

  it('exempts only the orbit hierarchy, not a third star on the same spot', () => {
    const a = star(5);
    const b = star(5);
    const c = star(5);
    expect(physicalOverlaps([a, b, c], [[a, b]])).toEqual([[a, c], [b, c]]);
  });

  it('exempts two members of one hierarchy that share no orbit pair', () => {
    const aa = star(5);
    const ab = star(5);
    const aa2 = star(5);
    expect(physicalOverlaps([aa, ab, aa2], [[aa, ab], [aa, aa2]])).toEqual([]);
  });

  it('flags members of two separate hierarchies on one spot', () => {
    const a = star(5);
    const b = star(5);
    const c = star(5);
    const d = star(5);
    expect(physicalOverlaps([a, b, c, d], [[a, b], [c, d]]))
      .toEqual([[a, c], [a, d], [b, c], [b, d]]);
  });

  it('returns each pair in record order whatever the sweep order', () => {
    const a = star(3 * R_SUN_PC);
    const b = star(2.5 * R_SUN_PC);
    expect(physicalOverlaps([a, b], [])).toEqual([[a, b]]);
  });
});
