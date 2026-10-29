import { describe, expect, it } from 'vitest';

import {
  GAIA_G_MINUS_B_BP_RP_MAX,
  GAIA_G_MINUS_B_BP_RP_MIN,
  GAIA_G_MINUS_B_COEFFS,
  GAIA_G_MINUS_B_GIANT_ONLY_BP_RP,
  GAIA_G_MINUS_B_SIGMA,
  GSPC_BP_RP_MAX,
  gaiaBMinusV,
  gaiaGMinusB,
  gspcBMinusV,
  resolveColourIndex,
  ciIsObserved,
} from './colour-index-pure';
import { RIELLO_BP_RP_MIN, rielloGMinusV } from './v-magnitude-pure';
import {
  GAIA_PHOTOMETRY_SATURATION_G,
  gatedValueOrNull,
  type GaiaPhotometry,
} from './gaia-photometry-pure';
import type { GspcColour } from './gspc-parse';
import { atColour, photometry } from './photometry-fixture';

const bv = (p: GaiaPhotometry): number | null => gatedValueOrNull(gaiaBMinusV(p));
const gspcBv = (p: GaiaPhotometry | null, g: GspcColour | null): number | null =>
  g === null ? null : gatedValueOrNull(gspcBMinusV(p, g));

describe('Gaia DR3 Table 5.9 G−B relation', () => {
  // The literals ARE the assertion: these are the published values, so the
  // test cannot import them from the module under test — a transcription
  // slip is exactly the failure it catches.
  it('carries the published coefficients, sigma and validity range', () => {
    expect([...GAIA_G_MINUS_B_COEFFS]).toEqual([
      0.01448, -0.6874, -0.3604, 0.06718, -0.006061,
    ]);
    expect(GAIA_G_MINUS_B_SIGMA).toBe(0.0633);
    expect(GAIA_G_MINUS_B_BP_RP_MIN).toBe(-0.5);
    expect(GAIA_G_MINUS_B_BP_RP_MAX).toBe(4.0);
    expect(GAIA_G_MINUS_B_GIANT_ONLY_BP_RP).toBe(1.75);
  });

  it('evaluates to the constant term at zero colour', () => {
    expect(gaiaGMinusB(0)).toBeCloseTo(0.01448, 12);
  });

  it('evaluates the quartic in ascending powers of BP−RP', () => {
    const x = 1.2;
    expect(gaiaGMinusB(x)).toBeCloseTo(
      0.01448 - 0.6874 * x - 0.3604 * x ** 2 + 0.06718 * x ** 3 - 0.006061 * x ** 4,
      12,
    );
  });
});

describe('gaiaBMinusV', () => {
  it('is the difference of the two Table 5.9 relations', () => {
    const x = 0.8;
    expect(bv(atColour(x))).toBeCloseTo(rielloGMinusV(x) - gaiaGMinusB(x), 12);
  });

  // Solar BP−RP is 0.82 (Casagrande 2018
  // (/data/papers/index.md#casagrande2018)); the true solar B−V is
  // 0.65, so this pins both the sign of the difference and the ~0.05 mag
  // offset the |Δci| distribution in README.md#the-ci-cascade reports.
  it('lands near the solar B−V at the solar colour', () => {
    const solar = bv(atColour(0.82))!;
    expect(solar).toBeGreaterThan(0.55);
    expect(solar).toBeLessThan(0.65);
  });

  it('reddens monotonically across the accepted range', () => {
    const blue = bv(atColour(0.0))!;
    const mid = bv(atColour(0.9))!;
    const red = bv(atColour(1.7))!;
    expect(blue).toBeLessThan(mid);
    expect(mid).toBeLessThan(red);
  });

  it('stops at the giant-only bound rather than the relation’s stated max', () => {
    expect(bv(atColour(GAIA_G_MINUS_B_GIANT_ONLY_BP_RP))).not.toBeNull();
    expect(bv(atColour(GAIA_G_MINUS_B_GIANT_ONLY_BP_RP + 0.001))).toBeNull();
    expect(bv(atColour(GAIA_G_MINUS_B_BP_RP_MAX - 0.5))).toBeNull();
  });

  // Both relations state the same blue end, so the difference has one bound —
  // asserting they agree is what would catch a revision moving only one.
  it('rejects colours below the blue bound the two relations share', () => {
    expect(GAIA_G_MINUS_B_BP_RP_MIN).toBe(RIELLO_BP_RP_MIN);
    expect(bv(atColour(RIELLO_BP_RP_MIN))).not.toBeNull();
    expect(bv(atColour(RIELLO_BP_RP_MIN - 0.001))).toBeNull();
  });

  it('rejects a saturated source, a missing band and a null row', () => {
    expect(bv(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G - 0.1 }))).toBeNull();
    expect(bv(photometry({ bpMag: null }))).toBeNull();
  });
});

describe('gspcBMinusV', () => {
  const synthetic = (bMinusV: number, inValidatedRange = false) =>
    ({ bMinusV, inValidatedRange });

  it('carries the measured colour bound, which is NOT the archive flag bound', () => {
    // 3.0 is where |Δ| against printed I/239 B−V breaks (0.043 → 0.135); the
    // flag's own bound is 2.6. README.md#why-the-gspc-tier-does-not-gate-on-the-flag
    // carries the distribution.
    expect(GSPC_BP_RP_MAX).toBe(3.0);
  });

  it('takes the synthetic colour up to the bound and drops it past', () => {
    expect(gspcBv(atColour(2.9), synthetic(2.1))).toBe(2.1);
    expect(gspcBv(atColour(GSPC_BP_RP_MAX), synthetic(2.1))).toBe(2.1);
    expect(gspcBv(atColour(3.01), synthetic(2.1))).toBeNull();
  });

  it('ignores the archive flag in both directions', () => {
    expect(gspcBv(atColour(2.0), synthetic(1.6, false))).toBe(1.6);
    expect(gspcBv(atColour(3.5), synthetic(1.6, true))).toBeNull();
  });

  it('keeps a colour blue of the flag box, which is bounded on one side only', () => {
    // The nine catalogue rows blue of −0.5 all reach printed first, so a blue
    // gate would only ever cost a measured colour — README.md#why-the-gspc-tier-does-not-gate-on-the-flag.
    expect(gspcBv(atColour(-1.0), synthetic(-0.33))).toBe(-0.33);
  });

  it('drops a saturated source — its BP/RP spectrum came off the same CCDs', () => {
    const saturated = photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G - 0.1 });
    expect(gspcBv(saturated, synthetic(2.0))).toBeNull();
  });

  it('is null without a colour to bound-check, or without a GSPC row', () => {
    expect(gspcBv(null, synthetic(2.0))).toBeNull();
    expect(gspcBv(atColour(2.0), null)).toBeNull();
  });
});

describe('resolveColourIndex cascade', () => {
  const sources = (overrides: Partial<Parameters<typeof resolveColourIndex>[0]> = {}) => ({
    photometry: null,
    gspc: { bMinusV: 2.1, inValidatedRange: false },
    printedHipBv: 1.2,
    apsisTeff: null,
    spectralCi: 1.4,
    ...overrides,
  });

  it('takes the Gaia relation when it applies, marked observed', () => {
    const r = resolveColourIndex(sources({ photometry: atColour(0.8) }));
    expect(r).toEqual({ via: 'gaia_relation', value: expect.any(Number), refusals: [] });
    expect(r).toMatchObject({ value: (gaiaBMinusV(atColour(0.8)) as { value: number }).value });
    expect(ciIsObserved(r.via)).toBe(true);
  });

  it('prefers the printed colour over the synthetic one', () => {
    // The inversion of the contract's stated order — the synthetic tier runs
    // outside the standardisation that ties it to the ground system, and
    // every corpus row carrying both prefers printed.
    expect(resolveColourIndex(sources({ photometry: atColour(2.5) }))).toMatchObject({
      via: 'printed_hip_bv', value: 1.2,
    });
    expect(ciIsObserved('printed_hip_bv')).toBe(true);
  });

  it('falls to the synthetic colour where no printed one exists', () => {
    expect(resolveColourIndex(sources({ photometry: atColour(2.5), printedHipBv: null })))
      .toMatchObject({ via: 'gspc', value: 2.1 });
    expect(ciIsObserved('gspc')).toBe(true);
  });

  it('skips a non-finite printed colour rather than propagating it', () => {
    expect(resolveColourIndex(sources({ photometry: atColour(2.5), printedHipBv: NaN })))
      .toMatchObject({ via: 'gspc', value: 2.1 });
  });

  it('skips the synthetic tier past its bound and with no photometry row', () => {
    const noPrinted = { printedHipBv: null } as const;
    expect(resolveColourIndex(sources({ ...noPrinted, photometry: atColour(3.5) })).via)
      .toBe('spectral_derived');
    // No broadband colour means the bound cannot be evaluated, so the tier is
    // skipped even though the pull carries a value.
    expect(resolveColourIndex(sources(noPrinted)).via).toBe('spectral_derived');
  });

  // The derived tier is intrinsic — de-extinction must not redden it a second
  // time (companionCiIsObserved gates on the same contract).
  it('derives the spectral colour only for a no-Apsis star, marked intrinsic', () => {
    expect(resolveColourIndex(sources({ gspc: null, printedHipBv: null })))
      .toEqual({ via: 'spectral_derived', value: 1.4, refusals: [] });
    expect(ciIsObserved('spectral_derived')).toBe(false);
    expect(resolveColourIndex(sources({ gspc: null, printedHipBv: null, apsisTeff: 5200 })))
      .toEqual({
        via: 'none',
        refusals: [{ tier: 'spectral_derived', reason: 'apsis_teff_renders' }],
      });
  });

  it('reaches none when the class yields no derivable colour, and none is intrinsic', () => {
    expect(resolveColourIndex(sources({ gspc: null, printedHipBv: null, spectralCi: null })))
      .toEqual({ via: 'none', refusals: [] });
    expect(ciIsObserved('none')).toBe(false);
  });

  it('names every candidate it passed over, on whichever tier it lands', () => {
    expect(resolveColourIndex(sources({
      photometry: atColour(3.5), printedHipBv: NaN, apsisTeff: 5200,
    })).refusals).toEqual([
      { tier: 'gaia_relation', reason: 'colour_out_of_range' },
      { tier: 'printed_hip_bv', reason: 'non_finite' },
      { tier: 'gspc', reason: 'colour_out_of_range' },
      { tier: 'spectral_derived', reason: 'apsis_teff_renders' },
    ]);
  });
});
