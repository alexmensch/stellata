import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';
import {
  RESOLVED_HOLE_BANDS,
  RESOLVED_HOLE_DEX_PER_SHELL,
  RESOLVED_HOLE_LOG_DISTANCE0,
  RESOLVED_HOLE_SHELLS,
  SHIPPED_RESOLVED_HOLE,
  type ResolvedHoleTable,
  clampResolvedHoleStrength,
  resolvedHoleBandEdges,
  resolvedHoleCatalogueMismatch,
  resolvedHoleIndex,
  resolvedHoleShellEdgesPc,
  resolvedHoleUv,
  resolvedLightFraction,
  sampleTexelCentres,
  unresolvedHoleVoxels,
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

  // A hole over 1 makes the band's emissivity negative and its magnitude
  // NaN, and `setResolvedHoleStrength` is public whatever the slider caps at.
  it('admits no strength outside [0, 1]', () => {
    expect(clampResolvedHoleStrength(2)).toBe(1);
    expect(clampResolvedHoleStrength(-1)).toBe(0);
    for (const k of [2, -1]) {
      const voxels = unresolvedHoleVoxels(k);
      let min = Infinity, max = -Infinity;
      for (const v of voxels) { min = Math.min(min, v); max = Math.max(max, v); }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
    }
  });

  // Over the 4.9e-4 round-to-nearest bound because three's converter
  // truncates. Taken on the voxels the texture stores, not the table they
  // are sampled from. What it is worth on a sightline: ../milkyway.test.ts.
  it('quantises to half-float inside 8.6e-4 relative', () => {
    let worst = 0;
    for (const v of unresolvedHoleVoxels()) {
      const back = DataUtils.fromHalfFloat(DataUtils.toHalfFloat(v));
      if (v > 0) worst = Math.max(worst, Math.abs(back - v) / v);
    }
    expect(worst).toBeCloseTo(8.511e-4, 7);
  });
});

// The 2D rule the cube is built through, not what the shaders fetch —
// they take a trilinear sample of the cube this produces.
describe('the table sampler the cube is resampled with', () => {
  it('puts each cell centre on its own texel centre', () => {
    for (const s of [0, 7, RESOLVED_HOLE_SHELLS - 1]) {
      const [u] = resolvedHoleUv(shellCentrePc(s), 0);
      expect(u * RESOLVED_HOLE_SHELLS).toBeCloseTo(s + 0.5, 9);
    }
    for (const b of [0, 3, RESOLVED_HOLE_BANDS - 1]) {
      const [, v] = resolvedHoleUv(100, bandCentre(b));
      expect(v * RESOLVED_HOLE_BANDS).toBeCloseTo(b + 0.5, 9);
    }
  });

  // Every value the fetch can return comes off a table clamped to [0, 1],
  // so nothing a filter weight does can take the band's emissivity
  // negative — the interpolation is a convex combination.
  it('never leaves the table\u2019s own range', () => {
    for (let i = 0; i <= 400; i++) {
      const d = 10 ** (0.5 + (i / 400) * 4.5);
      for (const sinB of [0, 0.31, 0.5, 0.87, 1]) {
        const [u, v] = resolvedHoleUv(d, sinB);
        const got = sampleTexelCentres(
          SHIPPED_RESOLVED_HOLE.values, RESOLVED_HOLE_SHELLS, RESOLVED_HOLE_BANDS, u, v);
        expect(got).toBeGreaterThanOrEqual(0);
        expect(got).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('resolvedHoleCatalogueMismatch', () => {
  it('says nothing when the loaded catalogue is the measured one', () => {
    expect(resolvedHoleCatalogueMismatch(RESOLVED_HOLE_CATALOGUE_RECORDS))
      .toBeNull();
  });

  it('names both counts when a shallower build loads', () => {
    const warning = resolvedHoleCatalogueMismatch(388071);
    expect(warning).not.toBeNull();
    expect(warning).toContain('388,071');
    expect(warning).toContain(RESOLVED_HOLE_CATALOGUE_RECORDS.toLocaleString());
    expect(warning).toContain('measure:band-resolved');
  });
});
