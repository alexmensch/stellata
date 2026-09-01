import { describe, it, expect } from 'vitest';

import { gaiaAstrometryRow } from '../astrometry-fixture';
import {
  radialTermExceedsCeiling,
  resolveRadialVelocity,
  rvErrorBand,
} from './radial-velocity';
import { VELOCITY_SANITY_CEILING_KM_S } from '../direction-cascade';

describe('resolveRadialVelocity cascade', () => {
  // The published shape: an rv always arrives with its own error.
  const withRv = (rv: number | null) =>
    gaiaAstrometryRow({
      parallaxMas: 50, pmraMasyr: 10, pmdecMasyr: -10,
      radialVelocityKmS: rv, radialVelocityErrorKmS: rv === null ? null : 0.35,
    });

  const LITERATURE = '2006AstL...32..759G';
  const GAIA_DR2 = '2018yCat.1345....0G';
  const GAIA_DR3 = '2022yCat.1355....0G';
  const simbadRv = (kmS: number, bibcode = LITERATURE) => ({ kmS, bibcode });
  const gaia = (rvKmS: number) => ({
    rvKmS, via: 'gaia_dr3' as const, bibcode: null,
    gaiaBibcodeCited: false, gaiaBibcodeSkipped: false,
  });
  const simbad = (rvKmS: number, bibcode = LITERATURE, gaiaBibcodeCited = false) => ({
    rvKmS, via: 'simbad' as const, bibcode, gaiaBibcodeCited, gaiaBibcodeSkipped: false,
  });
  const NONE = {
    rvKmS: null, via: 'none' as const, bibcode: null,
    gaiaBibcodeCited: false, gaiaBibcodeSkipped: false,
  };

  it('takes Gaia DR3 radial_velocity when RVS reached the source', () => {
    expect(resolveRadialVelocity(withRv(-110.51), simbadRv(22.4))).toEqual(gaia(-110.51));
  });

  // RVS is magnitude-limited, so the SIMBAD tier is not a degraded copy of the
  // Gaia tier — it is the only velocity most of this cohort has.
  it('falls to the SIMBAD tier when Gaia carries no RV', () => {
    expect(resolveRadialVelocity(withRv(null), simbadRv(22.4))).toEqual(simbad(22.4));
  });

  it('falls to the SIMBAD tier when there is no Gaia row at all', () => {
    expect(resolveRadialVelocity(null, simbadRv(22.4))).toEqual(simbad(22.4));
  });

  // ξ UMa's shape: a 2p row whose RVS median is the pair's, 11 km/s from the
  // systemic value. RVS reads the window the astrometric fit failed on.
  it('refuses the Gaia tier on a 2p row, taking the SIMBAD value', () => {
    const twoP = gaiaAstrometryRow({ ipdFracMultiPeak: 24, radialVelocityKmS: -26.78 });
    expect(resolveRadialVelocity(twoP, simbadRv(-15.9))).toEqual(simbad(-15.9));
  });

  // The skip rule: the withheld Gaia value coming back under a Gaia bibcode
  // is the same measurement, so the row falls to zero rather than launder it.
  it('skips a Gaia-bibcoded SIMBAD value where its own gate withheld the Gaia rv', () => {
    const twoP = gaiaAstrometryRow({ ipdFracMultiPeak: 24, radialVelocityKmS: -26.78 });
    expect(resolveRadialVelocity(twoP, simbadRv(-26.78, GAIA_DR3)))
      .toEqual({ ...NONE, gaiaBibcodeSkipped: true });
  });

  // Nothing was withheld on a row Gaia never measured, so a Gaia catalogue
  // bibcode there is an ordinary citation, and the shipped value says so.
  it('keeps a Gaia-bibcoded SIMBAD value where Gaia published no rv', () => {
    expect(resolveRadialVelocity(withRv(null), simbadRv(22.4, GAIA_DR3)))
      .toEqual(simbad(22.4, GAIA_DR3, true));
    expect(resolveRadialVelocity(null, simbadRv(22.4, GAIA_DR3)))
      .toEqual(simbad(22.4, GAIA_DR3, true));
  });

  // The rule turns on the blend, not on holding the competing value: a 2p row
  // Gaia published no rv for is the same unseparated spectrum, and its
  // Gaia-bibcoded candidate is that spectrum under Gaia's own reduction.
  // 102 rows of this build, all DR2.
  it('skips a Gaia-bibcoded value on a 2p row even with no Gaia rv to compare', () => {
    const twoPNoRv = gaiaAstrometryRow({ ipdFracMultiPeak: 24, radialVelocityKmS: null });
    expect(resolveRadialVelocity(twoPNoRv, simbadRv(-15.9, GAIA_DR2)))
      .toEqual({ ...NONE, gaiaBibcodeSkipped: true });
  });

  // ...and the literature value on that same row is untouched: the rule is
  // about Gaia's own reduction reappearing, not about distrusting the row's
  // every velocity.
  it('keeps a literature value on a 2p row Gaia published no rv for', () => {
    const twoPNoRv = gaiaAstrometryRow({ ipdFracMultiPeak: 24, radialVelocityKmS: null });
    expect(resolveRadialVelocity(twoPNoRv, simbadRv(-15.9))).toEqual(simbad(-15.9));
  });

  it('reports no tier when a 2p row is all the rv there is', () => {
    expect(resolveRadialVelocity(gaiaAstrometryRow({ radialVelocityKmS: -26.78 }), null))
      .toEqual(NONE);
  });

  // DR3 is taken as published: a large stated uncertainty is banded and
  // pinned, never a reason to route around the measurement.
  it('takes the Gaia tier however large the stated uncertainty is', () => {
    const noisy = gaiaAstrometryRow({
      parallaxMas: 5, radialVelocityKmS: -80.3, radialVelocityErrorKmS: 39.9,
    });
    expect(resolveRadialVelocity(noisy, simbadRv(-15.9))).toEqual(gaia(-80.3));
  });

  it('keeps a genuine zero rather than falling through it', () => {
    expect(resolveRadialVelocity(withRv(0), simbadRv(22.4))).toEqual(gaia(0));
    expect(resolveRadialVelocity(null, simbadRv(0))).toEqual(simbad(0));
  });

  it('reports no tier when neither source carries one', () => {
    expect(resolveRadialVelocity(null, null)).toEqual(NONE);
  });

  // EZ Aqr's value: a published 6,824.7 km/s at 3.4 pc. Rejecting the term on
  // its own leaves the tangential motion alone — the whole-vector clamp is for
  // a PM×distance artifact, where it is the PM that cannot be trusted.
  it('rejects a radial term past the sanity ceiling, and only past it', () => {
    expect(radialTermExceedsCeiling(6824.7)).toBe(true);
    expect(radialTermExceedsCeiling(-6824.7)).toBe(true);
    expect(radialTermExceedsCeiling(VELOCITY_SANITY_CEILING_KM_S)).toBe(false);
    expect(radialTermExceedsCeiling(VELOCITY_SANITY_CEILING_KM_S + 0.01)).toBe(true);
    expect(radialTermExceedsCeiling(650)).toBe(false);
    expect(radialTermExceedsCeiling(0)).toBe(false);
    expect(radialTermExceedsCeiling(null)).toBe(false);
  });

  it('bands the stated uncertainty on its upper edge, nulls to none', () => {
    expect(rvErrorBand(null)).toBe('none');
    expect(rvErrorBand(0)).toBe('le1');
    expect(rvErrorBand(1)).toBe('le1');
    expect(rvErrorBand(1.01)).toBe('le5');
    expect(rvErrorBand(10)).toBe('le10');
    expect(rvErrorBand(20)).toBe('le20');
    expect(rvErrorBand(20.01)).toBe('gt20');
    expect(rvErrorBand(39.9433)).toBe('gt20');
  });
});
