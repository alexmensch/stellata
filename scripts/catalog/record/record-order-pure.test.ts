import { describe, it, expect } from 'vitest';

import { FLAG_IS_SOL } from '../../../src/catalog-format/record/catalog-pure';
import { apparentVFromSol, assertSolFirst, sortByApparentV } from './record-order-pure';
import { enterPhase } from './record-phase';

describe('assertSolFirst', () => {
  it('passes only when the one record flagged Sol is record 0', () => {
    const flags = (...f: number[]) => f.map((x) => ({ flags: x }));
    expect(() => assertSolFirst(flags(FLAG_IS_SOL, 0))).not.toThrow();
    expect(() => assertSolFirst(flags(0, FLAG_IS_SOL, 0))).toThrow('it sorted to record 1');
    expect(() => assertSolFirst(flags(0, 0))).toThrow('found 0');
    expect(() => assertSolFirst(flags(FLAG_IS_SOL, FLAG_IS_SOL))).toThrow('found 2');
  });
});

describe('sortByApparentV', () => {
  const record = (x: number, absmag: number, flags = 0) => ({ x, y: 0, z: 0, absmag, flags });

  it('orders brightest-looking first, adds each A_V back, and hands on each record\'s key', () => {
    const sol = record(0, 4.83, FLAG_IS_SOL);
    const near = record(10, 5);
    const reddened = record(10, 1);
    const av = (r: { x: number; absmag: number }) => (r === reddened ? 6 : 0);
    const { sorted, sortedKey } = sortByApparentV(enterPhase('promoted', [near, reddened, sol]), av);
    expect([...sorted]).toEqual([sol, near, reddened]);
    expect(sortedKey).toEqual([apparentVFromSol(sol, 0), apparentVFromSol(near, 0), apparentVFromSol(reddened, 6)]);
  });

  it('throws on a non-finite key before sorting, and unless Sol sorts first', () => {
    expect(() => sortByApparentV(enterPhase('promoted', [record(0, 4.83, FLAG_IS_SOL), record(10, NaN)]), () => 0))
      .toThrow('Record 1 has a non-finite apparent V sort key');
    expect(() => sortByApparentV(enterPhase('promoted', [record(10, 5)]), () => 0)).toThrow('found 0');
  });
});
