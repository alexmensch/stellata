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
  PRINTED_V_TIERS,
  V_VIA_VALUES,
  printedV,
  printedVLookups,
  tycho2VMagnitude,
  vTierIsSystemBlend,
  type PrintedV,
} from './v-magnitude-pure';
import {
  GAIA_PHOTOMETRY_SATURATION_G,
  gatedValueOrNull,
  type GaiaPhotometry,
} from './gaia-photometry-pure';
import { photometry, printedVOf } from './photometry-fixture';

describe('Riello 2021 G−V relation', () => {
  // The literals ARE the assertion: these are the published Table 5.9 values
  // (Gaia EDR3 documentation, section "Photometric relationships with other
  // photometric systems"). A transcription slip is the failure this catches,
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

  // A contract with the G-only magnitude pull, not a property read here —
  // README.md#citation.
  it('peaks at −0.0268, the headroom the G-only magnitude pull relies on', () => {
    let peak = -Infinity;
    for (let x = RIELLO_BP_RP_MIN; x <= RIELLO_BP_RP_MAX; x += 0.0001) {
      peak = Math.max(peak, rielloGMinusV(x));
    }
    expect(peak).toBeCloseTo(-0.02680, 5);
  });
});

describe('rielloVMagnitude', () => {
  const UNCALIBRATED = { kind: 'refused', reason: 'uncalibrated' };
  const OUT_OF_RANGE = { kind: 'refused', reason: 'colour_out_of_range' };

  it('transforms a well-measured unsaturated source inside the colour range', () => {
    // G = 10, BP-RP = 0.8: the gate's own inputs, so the returned V proves the
    // transform ran on the values the gate accepted rather than a re-derivation.
    expect(gatedValueOrNull(rielloVMagnitude(photometry())))
      .toBeCloseTo(10 - rielloGMinusV(0.8), 12);
  });

  it('rejects a missing band', () => {
    expect(rielloVMagnitude(photometry({ bpMag: null }))).toEqual(UNCALIBRATED);
    expect(rielloVMagnitude(photometry({ rpMag: null }))).toEqual(UNCALIBRATED);
    expect(rielloVMagnitude(photometry({ gMag: null }))).toEqual(UNCALIBRATED);
  });

  it('rejects a non-finite band rather than returning NaN', () => {
    expect(rielloVMagnitude(photometry({ gMag: Number.NaN }))).toEqual(UNCALIBRATED);
    expect(rielloVMagnitude(photometry({ bpMag: Number.POSITIVE_INFINITY }))).toEqual(UNCALIBRATED);
  });

  it('rejects a source Gaia saturates, accepting exactly at the bound', () => {
    expect(rielloVMagnitude(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G - 0.01 })))
      .toEqual(UNCALIBRATED);
    expect(rielloVMagnitude(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G })).kind)
      .toBe('value');
  });

  it('rejects colours outside the published range at both ends', () => {
    expect(rielloVMagnitude(photometry({ bpMag: 10, rpMag: 10.6 }))).toEqual(OUT_OF_RANGE);
    expect(rielloVMagnitude(photometry({ bpMag: 16, rpMag: 10.9 }))).toEqual(OUT_OF_RANGE);
    expect(rielloVMagnitude(photometry({ bpMag: 10, rpMag: 10.5 })).kind).toBe('value');
    expect(rielloVMagnitude(photometry({ bpMag: 15.5, rpMag: 10.5 })).kind).toBe('value');
  });
});

describe('resolveVMagnitude cascade', () => {
  const PRINTED_HIP = { vVia: 'printed_hip', vMag: 2.5, key: 1 } as const;
  const resolve = (
    p: GaiaPhotometry | null, printed: PrintedV | null, curatedV: number | null = null,
  ) => resolveVMagnitude({ photometry: p, printed, curatedV });

  it('transforms Gaia photometry when the relation applies', () => {
    const r = resolve(photometry({ gMag: 10, bpMag: 10.5, rpMag: 9.7 }), PRINTED_HIP);
    expect(r.via).toBe('gaia_riello');
    expect(r.via === 'none' ? null : r.value).toBeCloseTo(10 - rielloGMinusV(0.8), 12);
  });

  // The bright rescue tier: Gaia saturates, so the printed V wins even though a
  // full photometry row exists — and the result names the refused transform.
  it('falls to the printed V when Gaia saturates the source', () => {
    expect(resolve(photometry({ gMag: 2.1 }), PRINTED_HIP)).toEqual({
      via: 'printed_hip', value: 2.5,
      refusals: [{ tier: 'gaia_riello', reason: 'uncalibrated' }],
    });
  });

  it('falls to the printed V when a band is missing', () => {
    expect(resolve(photometry({ bpMag: null }), { vVia: 'gliese', vMag: 11.7, key: '914' }))
      .toEqual({
        via: 'gliese', value: 11.7,
        refusals: [{ tier: 'gaia_riello', reason: 'uncalibrated' }],
      });
  });

  it('takes the curated value only where nothing else answers', () => {
    expect(resolve(null, null, -26.74)).toEqual({ via: 'curated', value: -26.74, refusals: [] });
    expect(resolve(null, PRINTED_HIP, -26.74))
      .toEqual({ via: 'printed_hip', value: 2.5, refusals: [] });
  });

  it('reports no tier when every source is absent', () => {
    expect(resolve(null, null)).toEqual({ via: 'none', refusals: [] });
  });
});

describe('tycho2VMagnitude', () => {
  // ESA 1997 (/data/papers/index.md#esa1997) SP-1200 Sect. 1.3:
  // V = VT − 0.090(BT−VT).
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

describe('printedV', () => {
  const LOOKUPS = printedVOf({
    hip: new Map([[1, 6.0], [2, 4.0]]),
    tycho2: { 'a-1-1': 7.0, 'a-1-2': 5.5 },
    gliese: { 914: 9.0 },
  });
  const keys = (
    hip: number[], tycho2: string[], gliese: string[],
  ) => ({ printed_hip: hip, tycho2, gliese });

  it('states the cascade order once, between the Gaia tier and curated', () => {
    expect(PRINTED_V_TIERS).toEqual(['printed_hip', 'tycho2', 'gliese']);
    expect(V_VIA_VALUES).toEqual(['gaia_riello', ...PRINTED_V_TIERS, 'curated', 'none']);
  });

  it('answers from the highest tier that has a key with a value', () => {
    expect(printedV(keys([1], ['a-1-1'], ['914']), LOOKUPS))
      .toEqual({ vVia: 'printed_hip', vMag: 6.0, key: 1 });
    expect(printedV(keys([99], ['a-1-1'], ['914']), LOOKUPS))
      .toEqual({ vVia: 'tycho2', vMag: 7.0, key: 'a-1-1', outsideRange: false });
    expect(printedV(keys([], ['nope-1-1'], ['914']), LOOKUPS))
      .toEqual({ vVia: 'gliese', vMag: 9.0, key: '914' });
  });

  // An overlay entry is keyed on a Gaia source several HIPs or Tycho entries
  // may route to, and saturation is a property of the brightest of them — so a
  // fainter sibling must not raise the V a binding gate answers for.
  it('takes the brightest of several keys within a tier, and names that key', () => {
    expect(printedV(keys([1, 2], [], []), LOOKUPS))
      .toEqual({ vVia: 'printed_hip', vMag: 4.0, key: 2 });
    expect(printedV(keys([], ['a-1-2', 'a-1-1'], []), LOOKUPS))
      .toEqual({ vVia: 'tycho2', vMag: 5.5, key: 'a-1-2', outsideRange: false });
  });

  it('is null where no tier answers', () => {
    expect(printedV(keys([], [], []), LOOKUPS)).toBeNull();
    expect(printedV(keys([99], ['nope-1-1'], ['0']), LOOKUPS)).toBeNull();
  });

  // A NaN cell must not pass as a measurement — it would poison absmag and
  // then the brightest-first record sort.
  it('treats a non-finite tier value as no answer', () => {
    const nan = printedVOf({ hip: new Map([[1, Number.NaN]]), tycho2: { 'a-1-1': Number.NaN }, gliese: { 914: 9.0 } });
    expect(printedV(keys([1], ['a-1-1'], ['914']), nan))
      .toEqual({ vVia: 'gliese', vMag: 9.0, key: '914' });
  });
});

describe('printedVLookups', () => {
  // Both binding gates and the astrometry request weigh candidates through
  // this one bundle; a site spelling its own pair is how the three drift on
  // reachable evidence (/docs/catalog-driver.md#4-how-hd-reaches-gaia).
  it('reduces a Tycho-2 row through the published VT relation', () => {
    const lookups = printedVLookups(
      new Map([[7, 3.1]]),
      new Map([['a-1-1', { btMag: 9.5, vtMag: 8.9 }]]),
      { byKey: new Map(), rowCount: 0 },
    );
    expect(lookups.printed_hip(7)).toEqual({ vMag: 3.1 });
    expect(lookups.printed_hip(8)).toBeNull();
    expect(lookups.tycho2('a-1-1')?.vMag).toBeCloseTo(tycho2VMagnitude(9.5, 8.9).v!, 12);
    expect(lookups.tycho2('missing')).toBeNull();
  });

  // The counter reads the flag off the answer that supplied the V, so it
  // cannot describe a different Tycho-2 row than the one the cascade used.
  it('carries the BT−VT range verdict on the Tycho-2 answer', () => {
    const lookups = printedVLookups(
      new Map(),
      new Map([['in-1-1', { btMag: 9.5, vtMag: 8.9 }], ['out-1-1', { btMag: 12.0, vtMag: 8.9 }]]),
      { byKey: new Map(), rowCount: 0 },
    );
    expect(lookups.tycho2('in-1-1')?.outsideRange).toBe(false);
    expect(lookups.tycho2('out-1-1')?.outsideRange).toBe(true);
  });

  it('reads the Gliese arm through lookupGliese, not by the printed name', () => {
    // V/70A numbers the supplement `NN nnnn` and letters a blend's components
    // together, so a prefix match on Gl/GJ misses the population the tier
    // exists for (/data/gliese/README.md#the-join-key).
    const lookups = printedVLookups(new Map(), new Map(), {
      byKey: new Map([['914', {
        vMag: 9.0, bv: null, parallax: null, spectralType: null,
      } as never]]),
      rowCount: 1,
    });
    expect(lookups.gliese('Gl 914')).toEqual({ vMag: 9.0 });
    expect(lookups.gliese('GJ 914B')).toEqual({ vMag: 9.0 });
    expect(lookups.gliese('Gl 915')).toBeNull();
  });
});
