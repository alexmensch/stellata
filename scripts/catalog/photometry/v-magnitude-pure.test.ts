import { describe, expect, it } from 'vitest';

import {
  RIELLO_BP_RP_MAX,
  RIELLO_BP_RP_MIN,
  RIELLO_G_MINUS_V_COEFFS,
  RIELLO_G_MINUS_V_SIGMA,
  TYCHO2_BT_MINUS_VT_MAX,
  TYCHO2_BT_MINUS_VT_MIN,
  TYCHO2_V_FROM_VT_COEFF,
  rielloVMagnitude,
  resolveVMagnitude,
  rielloGMinusV,
  printedVBelowHip,
  printedVLookups,
  tycho2VMagnitude,
  vTierIsSystemBlend,
} from './v-magnitude-pure';
import { GAIA_PHOTOMETRY_SATURATION_G } from './gaia-photometry-pure';
import { photometry, printedVOf } from './photometry-fixture';

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

describe('rielloVMagnitude', () => {
  it('transforms a well-measured unsaturated source inside the colour range', () => {
    // G = 10, BP-RP = 0.8: the gate's own inputs, so the returned V proves the
    // transform ran on the values the gate accepted rather than a re-derivation.
    expect(rielloVMagnitude(photometry())).toBeCloseTo(10 - rielloGMinusV(0.8), 12);
  });

  it('rejects a missing band', () => {
    expect(rielloVMagnitude(photometry({ bpMag: null }))).toBeNull();
    expect(rielloVMagnitude(photometry({ rpMag: null }))).toBeNull();
    expect(rielloVMagnitude(photometry({ gMag: null }))).toBeNull();
  });

  it('rejects a non-finite band rather than returning NaN', () => {
    expect(rielloVMagnitude(photometry({ gMag: Number.NaN }))).toBeNull();
    expect(rielloVMagnitude(photometry({ bpMag: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('rejects a source Gaia saturates, accepting exactly at the bound', () => {
    expect(rielloVMagnitude(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G - 0.01 })))
      .toBeNull();
    expect(rielloVMagnitude(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G })))
      .not.toBeNull();
  });

  it('rejects colours outside the published range at both ends', () => {
    expect(rielloVMagnitude(photometry({ bpMag: 10, rpMag: 10.6 }))).toBeNull();
    expect(rielloVMagnitude(photometry({ bpMag: 16, rpMag: 10.9 }))).toBeNull();
    expect(rielloVMagnitude(photometry({ bpMag: 10, rpMag: 10.5 }))).not.toBeNull();
    expect(rielloVMagnitude(photometry({ bpMag: 15.5, rpMag: 10.5 }))).not.toBeNull();
  });

  it('rejects a null photometry row outright', () => {
    expect(rielloVMagnitude(null)).toBeNull();
  });
});

describe('resolveVMagnitude cascade', () => {
  it('transforms Gaia photometry when the relation applies', () => {
    const r = resolveVMagnitude(photometry({ gMag: 10, bpMag: 10.5, rpMag: 9.7 }), 12, 13, 14);
    expect(r.via).toBe('gaia_riello');
    expect(r.v).toBeCloseTo(10 - rielloGMinusV(0.8), 12);
  });

  // The bright rescue tier: Gaia saturates, so the printed Hipparcos V wins
  // even though a full photometry row exists.
  it('falls to printed HIP V when Gaia saturates the source', () => {
    const r = resolveVMagnitude(photometry({ gMag: 2.1 }), 2.5, 9, 10);
    expect(r).toEqual({ v: 2.5, via: 'printed_hip' });
  });

  it('falls to printed HIP V when a band is missing', () => {
    const r = resolveVMagnitude(photometry({ bpMag: null }), 7.25, 9, 10);
    expect(r).toEqual({ v: 7.25, via: 'printed_hip' });
  });

  it('falls to Tycho-2 when no printed V exists', () => {
    const r = resolveVMagnitude(photometry({ gMag: 2.1 }), null, 2.4, 9);
    expect(r).toEqual({ v: 2.4, via: 'tycho2' });
  });

  it('falls to Gliese when Tycho-2 misses the row too', () => {
    expect(resolveVMagnitude(null, null, null, 11.7))
      .toEqual({ v: 11.7, via: 'gliese' });
  });

  it('reports no tier when every source is absent', () => {
    expect(resolveVMagnitude(null, null, null, null))
      .toEqual({ v: null, via: 'none' });
  });

  // A NaN cell must not pass as a measurement — it would poison absmag and
  // then the brightest-first record sort.
  it('skips a non-finite value rather than propagating it', () => {
    expect(resolveVMagnitude(null, Number.NaN, 8.4, 9))
      .toEqual({ v: 8.4, via: 'tycho2' });
    expect(resolveVMagnitude(photometry({ gMag: Number.NaN }), null, Number.NaN, 8.4).via)
      .toBe('gliese');
  });
});

describe('tycho2VMagnitude', () => {
  // SP-1200 § 1.3: V = VT − 0.090(BT−VT).
  it('reduces VT to Johnson V through the published coefficient', () => {
    expect(tycho2VMagnitude(9.5, 8.9).v).toBeCloseTo(8.9 - 0.090 * 0.6, 12);
  });

  it('needs both bands', () => {
    expect(tycho2VMagnitude(null, 8.9).v).toBeNull();
    expect(tycho2VMagnitude(9.5, null).v).toBeNull();
    expect(tycho2VMagnitude(Number.NaN, 8.9).v).toBeNull();
  });

  // Ungated on purpose — the rows outside the published range have no tier
  // below them, so refusing the value would cost each its record. The
  // population is counted instead, which is what this pins.
  it('still transforms outside the published colour range, and flags it', () => {
    expect(tycho2VMagnitude(13.0, 10.31).v).not.toBeNull();
    expect(tycho2VMagnitude(13.0, 10.31).outsideRange).toBe(true);   // BT−VT 2.69
    expect(tycho2VMagnitude(9.5, 8.9).outsideRange).toBe(false);     // BT−VT 0.60
    expect(tycho2VMagnitude(8.618, 8.9).outsideRange).toBe(true);    // BT−VT −0.282
    expect(tycho2VMagnitude(null, 8.9).outsideRange).toBe(false);
  });

  it('pins the published coefficient and range as literals', () => {
    expect(TYCHO2_V_FROM_VT_COEFF).toBe(0.090);
    expect(TYCHO2_BT_MINUS_VT_MIN).toBe(-0.25);
    expect(TYCHO2_BT_MINUS_VT_MAX).toBe(2.0);
  });
});

describe('vTierIsSystemBlend', () => {
  // Companion promotion may only subtract a companion's flux from a magnitude
  // that sums the system, so a tier wrongly reported here double-counts or
  // strands the companion's light.
  it('is true for the printed tiers and false for Gaia and for no cascade', () => {
    expect(vTierIsSystemBlend('printed_hip')).toBe(true);
    expect(vTierIsSystemBlend('tycho2')).toBe(true);
    expect(vTierIsSystemBlend('gliese')).toBe(true);
    expect(vTierIsSystemBlend('gaia_riello')).toBe(false);
    expect(vTierIsSystemBlend('none')).toBe(false);
    expect(vTierIsSystemBlend(null)).toBe(false);
  });
});

describe('printedVBelowHip', () => {
  const LOOKUPS = printedVOf({ 'a-1-1': 7.0, 'a-1-2': 5.5 }, { 914: 9.0 });

  it('answers from Tycho-2 first, as the cascade orders the two tiers', () => {
    expect(printedVBelowHip(['a-1-1'], ['914'], LOOKUPS))
      .toEqual({ vMag: 7.0, vVia: 'tycho2' });
  });

  it('falls to Gliese only where no Tycho entry answers', () => {
    expect(printedVBelowHip(['nope-1-1'], ['914'], LOOKUPS))
      .toEqual({ vMag: 9.0, vVia: 'gliese' });
    expect(printedVBelowHip([], ['914'], LOOKUPS))
      .toEqual({ vMag: 9.0, vVia: 'gliese' });
  });

  // An overlay entry is keyed on a Gaia source IV/25 may route several Tycho
  // entries to, and saturation is a property of the brightest of them — so a
  // fainter sibling must not raise the V a binding gate answers for.
  it('takes the brightest of several keys within a tier', () => {
    expect(printedVBelowHip(['a-1-1', 'a-1-2'], [], LOOKUPS))
      .toEqual({ vMag: 5.5, vVia: 'tycho2' });
    expect(printedVBelowHip(['a-1-2', 'a-1-1'], [], LOOKUPS))
      .toEqual({ vMag: 5.5, vVia: 'tycho2' });
  });

  it('is null where neither tier answers, which is a pass and not a rejection', () => {
    expect(printedVBelowHip([], [], LOOKUPS)).toBeNull();
    expect(printedVBelowHip(['nope-1-1'], ['0'], LOOKUPS)).toBeNull();
  });

  it('treats a non-finite tier value as no answer', () => {
    const nan = printedVOf({ 'a-1-1': Number.NaN }, { 914: 9.0 });
    expect(printedVBelowHip(['a-1-1'], ['914'], nan))
      .toEqual({ vMag: 9.0, vVia: 'gliese' });
  });
});

describe('printedVLookups', () => {
  // Both binding gates and the astrometry request weigh candidates through
  // this one bundle; a site spelling its own pair is how the three drift on
  // reachable evidence (docs/catalog-driver.md § 4).
  it('reduces a Tycho-2 row through the published VT relation', () => {
    const lookups = printedVLookups(
      new Map([['a-1-1', { btMag: 9.5, vtMag: 8.9 }]]),
      { byKey: new Map(), rowCount: 0 },
    );
    expect(lookups.tycho2VOfTyc('a-1-1')).toBeCloseTo(tycho2VMagnitude(9.5, 8.9).v!, 12);
    expect(lookups.tycho2VOfTyc('missing')).toBeNull();
  });

  it('reads the Gliese arm through lookupGliese, not by the printed name', () => {
    // V/70A numbers the supplement `NN nnnn` and letters a blend's components
    // together, so a prefix match on Gl/GJ misses the population the tier
    // exists for (data/gliese/README.md § The join key).
    const lookups = printedVLookups(new Map(), {
      byKey: new Map([['914', {
        vMag: 9.0, bv: null, parallax: null, spectralType: null,
      } as never]]),
      rowCount: 1,
    });
    expect(lookups.glieseVOfGj('Gl 914')).toBe(9.0);
    expect(lookups.glieseVOfGj('GJ 914B')).toBe(9.0);
    expect(lookups.glieseVOfGj('Gl 915')).toBeNull();
  });
});
