import { describe, expect, it } from 'vitest';

import {
  GAIA_PHOTOMETRY_SATURATION_G,
  RIELLO_BP_RP_MAX,
  RIELLO_BP_RP_MIN,
  RIELLO_G_MINUS_V_COEFFS,
  RIELLO_G_MINUS_V_SIGMA,
  V_VIA_VALUES,
  emptyVViaPartition,
  isRielloTransformable,
  resolveVMagnitude,
  rielloGMinusV,
  type GaiaPhotometry,
} from './v-magnitude-pure';

function photometry(overrides: Partial<GaiaPhotometry> = {}): GaiaPhotometry {
  return { gMag: 10, bpMag: 10.5, rpMag: 9.7, ...overrides };
}

describe('Riello+ 2021 G−V relation', () => {
  // The literals ARE the assertion: these are the published Table 5.7 values
  // (Gaia EDR3 documentation, § Photometric relationships with other
  // photometric systems). A transcription slip is the failure this catches,
  // so the test cannot import them from the module under test.
  it('carries the published coefficients, sigma and validity range', () => {
    expect([...RIELLO_G_MINUS_V_COEFFS]).toEqual([-0.02704, 0.01424, -0.2156, 0.01426]);
    expect(RIELLO_G_MINUS_V_SIGMA).toBe(0.03017);
    expect(RIELLO_BP_RP_MIN).toBe(-0.5);
    expect(RIELLO_BP_RP_MAX).toBe(5.0);
  });

  it('evaluates to the constant term at zero colour', () => {
    expect(rielloGMinusV(0)).toBe(-0.02704);
  });

  it('evaluates the cubic in ascending powers of BP−RP', () => {
    const x = 1.3;
    const expected = -0.02704 + 0.01424 * x - 0.2156 * x ** 2 + 0.01426 * x ** 3;
    expect(rielloGMinusV(x)).toBeCloseTo(expected, 12);
  });

  // G − V is negative across the whole valid range (Gaia's G band is broader
  // than Johnson V, so G is brighter), which means V > G for every star the
  // transform accepts. A sign error in the Horner fold shows up here.
  it('stays negative across the validity range, so V is always fainter than G', () => {
    for (let x = RIELLO_BP_RP_MIN; x <= RIELLO_BP_RP_MAX; x += 0.1) {
      expect(rielloGMinusV(x)).toBeLessThan(0);
    }
  });
});

describe('isRielloTransformable', () => {
  it('accepts a well-measured unsaturated source inside the colour range', () => {
    expect(isRielloTransformable(photometry())).toBe(true);
  });

  it('rejects a missing band', () => {
    expect(isRielloTransformable(photometry({ bpMag: null }))).toBe(false);
    expect(isRielloTransformable(photometry({ rpMag: null }))).toBe(false);
    expect(isRielloTransformable(photometry({ gMag: null }))).toBe(false);
  });

  it('rejects a source Gaia saturates', () => {
    expect(isRielloTransformable(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G - 0.01 })))
      .toBe(false);
    expect(isRielloTransformable(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G })))
      .toBe(true);
  });

  it('rejects colours outside the published range at both ends', () => {
    expect(isRielloTransformable(photometry({ bpMag: 10, rpMag: 10.6 }))).toBe(false);
    expect(isRielloTransformable(photometry({ bpMag: 16, rpMag: 10.9 }))).toBe(false);
    expect(isRielloTransformable(photometry({ bpMag: 10, rpMag: 10.5 }))).toBe(true);
    expect(isRielloTransformable(photometry({ bpMag: 15.5, rpMag: 10.5 }))).toBe(true);
  });

  it('rejects a null photometry row outright', () => {
    expect(isRielloTransformable(null)).toBe(false);
  });
});

describe('resolveVMagnitude cascade', () => {
  it('transforms Gaia photometry when the relation applies', () => {
    const r = resolveVMagnitude(photometry({ gMag: 10, bpMag: 10.5, rpMag: 9.7 }), 12, 13);
    expect(r.via).toBe('gaia_riello');
    expect(r.v).toBeCloseTo(10 - rielloGMinusV(0.8), 12);
  });

  // The bright rescue tier: Gaia saturates, so the printed Hipparcos V wins
  // even though a full photometry row exists.
  it('falls to printed HIP V when Gaia saturates the source', () => {
    const r = resolveVMagnitude(photometry({ gMag: 2.1 }), 2.5, 9);
    expect(r).toEqual({ v: 2.5, via: 'printed_hip' });
  });

  it('falls to printed HIP V when a band is missing', () => {
    const r = resolveVMagnitude(photometry({ bpMag: null }), 7.25, 9);
    expect(r).toEqual({ v: 7.25, via: 'printed_hip' });
  });

  it('falls to the catalogued cell when no printed V exists', () => {
    const r = resolveVMagnitude(photometry({ gMag: 2.1 }), null, 2.4);
    expect(r).toEqual({ v: 2.4, via: 'catalogued' });
  });

  it('falls to the catalogued cell when there is no photometry row at all', () => {
    expect(resolveVMagnitude(null, null, 11.7)).toEqual({ v: 11.7, via: 'catalogued' });
  });

  it('reports no tier when every source is absent', () => {
    expect(resolveVMagnitude(null, null, null)).toEqual({ v: null, via: 'none' });
  });

  // A NaN cell must not pass as a measurement — it would poison absmag and
  // then the brightest-first record sort.
  it('skips a non-finite value rather than propagating it', () => {
    expect(resolveVMagnitude(null, Number.NaN, 8.4)).toEqual({ v: 8.4, via: 'catalogued' });
    expect(resolveVMagnitude(photometry({ gMag: Number.NaN }), null, 8.4).via)
      .toBe('catalogued');
  });
});

describe('emptyVViaPartition', () => {
  it('carries a zeroed bucket for every declared tier', () => {
    const partition = emptyVViaPartition();
    expect(Object.keys(partition).sort()).toEqual([...V_VIA_VALUES].sort());
    expect(Object.values(partition).every((n) => n === 0)).toBe(true);
  });
});
