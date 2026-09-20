import { describe, expect, it } from 'vitest';
import {
  RESOLVED_HOLE_BANDS,
  RESOLVED_HOLE_DEX_PER_SHELL,
  RESOLVED_HOLE_LOG_DISTANCE0,
  RESOLVED_HOLE_SHELLS,
  SHIPPED_RESOLVED_HOLE,
  type ResolvedHoleTable,
  resolvedHoleBandEdges,
  resolvedHoleIndex,
  resolvedHoleShellEdgesPc,
  resolvedLightFraction,
  unresolvedLightFraction,
  writeResolvedHoleSlot,
} from './resolved-fraction-pure';
import {
  RESOLVED_HOLE_CATALOGUE_RECORDS,
  RESOLVED_HOLE_VALUES,
} from './resolved-hole-table';

/** A table whose value is its own (shell, band) pair, so a sample reads
 *  back which cells it blended. */
function coordinateTable(): ResolvedHoleTable {
  const values = new Array<number>(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS);
  for (let s = 0; s < RESOLVED_HOLE_SHELLS; s++) {
    for (let b = 0; b < RESOLVED_HOLE_BANDS; b++) values[resolvedHoleIndex(s, b)] = s + 100 * b;
  }
  return { values };
}

const shellCentrePc = (s: number) =>
  10 ** (RESOLVED_HOLE_LOG_DISTANCE0 + (s + 0.5) * RESOLVED_HOLE_DEX_PER_SHELL);
const bandCentre = (b: number) => (b + 0.5) / RESOLVED_HOLE_BANDS;

describe('the resolution-hole table layout', () => {
  it('spans 10 pc to 15.8 kpc in 32 tenth-dex shells and 8 equal-|sin b| bands', () => {
    const shells = resolvedHoleShellEdgesPc();
    expect(shells).toHaveLength(RESOLVED_HOLE_SHELLS + 1);
    expect(shells[0]).toBe(10);
    expect(shells[RESOLVED_HOLE_SHELLS]).toBeCloseTo(15848.9, 1);
    const bands = resolvedHoleBandEdges();
    expect(bands).toHaveLength(RESOLVED_HOLE_BANDS + 1);
    expect(bands[0]).toBe(0);
    expect(bands[RESOLVED_HOLE_BANDS]).toBe(1);
    expect(RESOLVED_HOLE_VALUES).toHaveLength(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS);
  });

  it('is band-major', () => {
    expect(resolvedHoleIndex(0, 1)).toBe(RESOLVED_HOLE_SHELLS);
    expect(resolvedHoleIndex(RESOLVED_HOLE_SHELLS - 1, RESOLVED_HOLE_BANDS - 1))
      .toBe(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS - 1);
  });
});

describe('sampling the table', () => {
  const t = coordinateTable();

  it('reads a cell exactly at its centre', () => {
    expect(resolvedLightFraction(shellCentrePc(7), bandCentre(3), t)).toBeCloseTo(307, 9);
  });

  it('blends linearly between neighbouring shells and bands', () => {
    const dMid = 10 ** (RESOLVED_HOLE_LOG_DISTANCE0 + 8 * RESOLVED_HOLE_DEX_PER_SHELL);
    expect(resolvedLightFraction(dMid, bandCentre(3), t)).toBeCloseTo(307.5, 9);
    expect(resolvedLightFraction(shellCentrePc(7), 4 / RESOLVED_HOLE_BANDS, t)).toBeCloseTo(357, 9);
  });

  it('clamps to the edge cells inside the first shell and past the last', () => {
    expect(resolvedLightFraction(1, 0, t)).toBe(0);
    expect(resolvedLightFraction(0, 0, t)).toBe(0);
    expect(resolvedLightFraction(1e6, 1, t)).toBe(RESOLVED_HOLE_SHELLS - 1 + 100 * (RESOLVED_HOLE_BANDS - 1));
  });

  it('is the complement of what the band still draws', () => {
    for (const [d, sinB] of [[20, 0], [150, 0.4], [2000, 0.9]]) {
      expect(resolvedLightFraction(d, sinB) + unresolvedLightFraction(d, sinB)).toBeCloseTo(1, 12);
    }
  });
});

describe('the shipped table', () => {
  it('was measured on the V ≤ 11 catalogue', () => {
    expect(RESOLVED_HOLE_CATALOGUE_RECORDS).toBe(983069);
    expect(SHIPPED_RESOLVED_HOLE.values).toBe(RESOLVED_HOLE_VALUES);
  });

  it('holds shares in [0, 1] that are whole nearby and gone far out', () => {
    for (const v of RESOLVED_HOLE_VALUES) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(resolvedLightFraction(10, 0)).toBe(1);
    expect(resolvedLightFraction(15_000, 0)).toBeLessThan(0.001);
  });

  it('resolves 59 % of the plane at 500 pc, 32 % at 1 kpc and 44 % of the pole at 250 pc', () => {
    expect(resolvedLightFraction(500, 0)).toBeCloseTo(0.59, 2);
    expect(resolvedLightFraction(1000, 0)).toBeCloseTo(0.32, 2);
    expect(resolvedLightFraction(250, 1)).toBeCloseTo(0.44, 2);
  });

  it('writes a scaled copy into a slot in place', () => {
    const slot = new Float32Array(RESOLVED_HOLE_VALUES.length);
    writeResolvedHoleSlot(slot, 0.5);
    expect(slot[resolvedHoleIndex(18, 0)]).toBeCloseTo(0.5 * RESOLVED_HOLE_VALUES[18], 6);
    writeResolvedHoleSlot(slot, 0);
    expect(Math.max(...slot)).toBe(0);
  });
});
