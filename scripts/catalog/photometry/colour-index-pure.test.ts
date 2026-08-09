import { describe, expect, it } from 'vitest';

import {
  GAIA_G_MINUS_B_BP_RP_MAX,
  GAIA_G_MINUS_B_COEFFS,
  GAIA_G_MINUS_B_GIANT_ONLY_BP_RP,
  GAIA_G_MINUS_B_SIGMA,
  gaiaBMinusV,
  gaiaGMinusB,
  resolveColourIndex,
} from './colour-index-pure';
import { RIELLO_BP_RP_MIN, rielloGMinusV } from './v-magnitude-pure';
import {
  GAIA_PHOTOMETRY_SATURATION_G,
  type GaiaPhotometry,
} from './gaia-photometry-pure';

function photometry(overrides: Partial<GaiaPhotometry> = {}): GaiaPhotometry {
  return { gMag: 10, bpMag: 10.5, rpMag: 9.7, ...overrides };
}

/** BP−RP giving the requested colour, at an unsaturated G. */
function atColour(bpMinusRp: number): GaiaPhotometry {
  return { gMag: 10, bpMag: 10 + bpMinusRp, rpMag: 10 };
}

describe('Gaia DR3 Table 5.9 G−B relation', () => {
  // The literals ARE the assertion: these are the published values, so the
  // test cannot import them from the module under test — a transcription
  // slip is exactly the failure it catches.
  it('carries the published coefficients, sigma and validity range', () => {
    expect([...GAIA_G_MINUS_B_COEFFS]).toEqual([
      0.01448, -0.6874, -0.3604, 0.06718, -0.006061,
    ]);
    expect(GAIA_G_MINUS_B_SIGMA).toBe(0.0633);
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
    expect(gaiaBMinusV(atColour(x))).toBeCloseTo(rielloGMinusV(x) - gaiaGMinusB(x), 12);
  });

  // Solar BP−RP is 0.82 (Casagrande & VandenBerg 2018); the true solar B−V is
  // 0.65, so this pins both the sign of the difference and the ~0.05 mag
  // offset the |Δci| distribution in README.md § The ci cascade reports.
  it('lands near the solar B−V at the solar colour', () => {
    const bv = gaiaBMinusV(atColour(0.82))!;
    expect(bv).toBeGreaterThan(0.55);
    expect(bv).toBeLessThan(0.65);
  });

  it('reddens monotonically across the accepted range', () => {
    const blue = gaiaBMinusV(atColour(0.0))!;
    const mid = gaiaBMinusV(atColour(0.9))!;
    const red = gaiaBMinusV(atColour(1.7))!;
    expect(blue).toBeLessThan(mid);
    expect(mid).toBeLessThan(red);
  });

  it('stops at the giant-only bound rather than the relation’s stated max', () => {
    expect(gaiaBMinusV(atColour(GAIA_G_MINUS_B_GIANT_ONLY_BP_RP))).not.toBeNull();
    expect(gaiaBMinusV(atColour(GAIA_G_MINUS_B_GIANT_ONLY_BP_RP + 0.001))).toBeNull();
    expect(gaiaBMinusV(atColour(GAIA_G_MINUS_B_BP_RP_MAX - 0.5))).toBeNull();
  });

  it('rejects colours below the shared blue bound', () => {
    expect(gaiaBMinusV(atColour(RIELLO_BP_RP_MIN))).not.toBeNull();
    expect(gaiaBMinusV(atColour(RIELLO_BP_RP_MIN - 0.001))).toBeNull();
  });

  it('rejects a saturated source, a missing band and a null row', () => {
    expect(gaiaBMinusV(photometry({ gMag: GAIA_PHOTOMETRY_SATURATION_G - 0.1 }))).toBeNull();
    expect(gaiaBMinusV(photometry({ bpMag: null }))).toBeNull();
    expect(gaiaBMinusV(null)).toBeNull();
  });
});

describe('resolveColourIndex cascade', () => {
  const SOLAR = 0.65;

  it('takes the Gaia relation when it applies, marked observed', () => {
    const r = resolveColourIndex(atColour(0.8), 1.2, null, 1.4, SOLAR);
    expect(r.via).toBe('gaia_relation');
    expect(r.ci).toBeCloseTo(gaiaBMinusV(atColour(0.8))!, 12);
    expect(r.isObserved).toBe(true);
  });

  it('falls to the catalogued cell when the relation does not apply', () => {
    const r = resolveColourIndex(atColour(3.0), 1.2, null, 1.4, SOLAR);
    expect(r).toEqual({ ci: 1.2, via: 'catalogued', isObserved: true });
  });

  it('falls to the catalogued cell when there is no photometry row at all', () => {
    expect(resolveColourIndex(null, 1.2, null, 1.4, SOLAR).via).toBe('catalogued');
  });

  it('skips a non-finite catalogued cell rather than propagating it', () => {
    const r = resolveColourIndex(null, NaN, null, 1.4, SOLAR);
    expect(r).toEqual({ ci: 1.4, via: 'spectral_derived', isObserved: false });
  });

  // The two derived tiers are intrinsic — de-extinction must not redden them
  // a second time (companionCiIsObserved gates on the same contract).
  it('derives the spectral colour only for a no-Apsis star, marked intrinsic', () => {
    const noApsis = resolveColourIndex(null, null, null, 1.4, SOLAR);
    expect(noApsis).toEqual({ ci: 1.4, via: 'spectral_derived', isObserved: false });
    const withApsis = resolveColourIndex(null, null, 5200, 1.4, SOLAR);
    expect(withApsis).toEqual({ ci: SOLAR, via: 'solar_fallback', isObserved: false });
  });

  it('falls to solar when the class yields no derivable colour', () => {
    const r = resolveColourIndex(null, null, null, null, SOLAR);
    expect(r).toEqual({ ci: SOLAR, via: 'solar_fallback', isObserved: false });
  });
});
