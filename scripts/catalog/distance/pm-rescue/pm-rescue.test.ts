import { describe, it, expect } from 'vitest';

import {
  pmRescueOutcome,
  resolvePmRescue,
  VELOCITY_VIA_BY_PM_RESCUE,
  type PmRescueResolution,
  type PmRescueSources,
} from './pm-rescue';
import type { CitedProperMotion } from '../../cited-proper-motion';
import { gaiaAstrometryRow } from '../astrometry-fixture';
import { TYCHO2_MEAN_EPOCH, type Tycho2Row } from '../../tycho2-parse';

const GAIA_DR2 = '2018yCat.1345....0G';
const GAIA_EDR3 = '2020yCat.1350....0G';
// UCAC4 of Zacharias 2012 (/data/papers/index.md#zacharias2012) and Fabricius 2002b
// (/data/papers/index.md#fabricius2002b) — the two literature bibcodes
// the shipped cohort's SIMBAD tier actually leans on.
const UCAC4 = '2012yCat.1322....0Z';
const FABRICIUS = '2002A&A...384..180F';

function tycho2Row(overrides: Partial<Tycho2Row> = {}): Tycho2Row {
  return {
    raDeg: 10, decDeg: 20, epoch: TYCHO2_MEAN_EPOCH,
    pmRaMasyr: -453.7, pmDecMasyr: -591.4,
    btMag: 5, vtMag: 4.5, fromIcrs: false, isPhotocentre: false, hip: null,
    ...overrides,
  };
}

function cited(
  overrides: Partial<CitedProperMotion> = {},
): CitedProperMotion {
  return { pmRaMasyr: 2314.8, pmDecMasyr: 2295.3, bibcode: UCAC4, ...overrides };
}

const TWO_P = gaiaAstrometryRow({ parallaxMas: null, pmraMasyr: null, pmdecMasyr: null });
const NOTHING: PmRescueSources = { tycho2: null, cns5: null, simbad: null, gaia: TWO_P };

const pmRa = (res: PmRescueResolution): number | null =>
  res.via === 'none' ? null : res.value.pmRaMasyr;
const pmDec = (res: PmRescueResolution): number | null =>
  res.via === 'none' ? null : res.value.pmDecMasyr;

describe('resolvePmRescue', () => {
  it('prefers Tycho-2, the one tier that predates Gaia', () => {
    const res = resolvePmRescue({ ...NOTHING, tycho2: tycho2Row(), cns5: cited(), simbad: cited() });
    expect(res.via).toBe('tycho2');
    expect(pmRa(res)).toBe(-453.7);
    expect(pmDec(res)).toBe(-591.4);
  });

  it('takes Tycho-2 on a 2p row without consulting any bibcode', () => {
    // Tycho-2 carries no per-value citation, so a Gaia release cannot be
    // hiding behind one — the skip rule has nothing to check here.
    expect(resolvePmRescue({ ...NOTHING, tycho2: tycho2Row() }).via).toBe('tycho2');
  });

  it('falls past Tycho-2 where the row has no mean solution', () => {
    const res = resolvePmRescue({
      ...NOTHING,
      tycho2: tycho2Row({ pmRaMasyr: null, pmDecMasyr: null, fromIcrs: true }),
      simbad: cited(),
      gaia: null,
    });
    expect(res.via).toBe('simbad');
  });

  it('puts CNS5 above the second-order SIMBAD index', () => {
    const res = resolvePmRescue({ ...NOTHING, cns5: cited({ pmRaMasyr: 50 }), simbad: cited() });
    expect(res.via).toBe('cns5');
    expect(pmRa(res)).toBe(50);
  });

  it('skips a Gaia-bibcoded PM on a 2p row rather than laundering it back', () => {
    const res = resolvePmRescue({ ...NOTHING, simbad: cited({ bibcode: GAIA_DR2 }) });
    expect(res).toEqual({
      via: 'none', refusals: [{ tier: 'simbad', reason: 'gaia_release' }],
    });
    expect(pmRescueOutcome(res)).toBe('gaia_bibcode_skipped');
  });

  it('skips CNS5 on a 2p row too — 87% of its PM is Gaia republished', () => {
    const res = resolvePmRescue({ ...NOTHING, cns5: cited({ bibcode: GAIA_EDR3 }) });
    expect(pmRescueOutcome(res)).toBe('gaia_bibcode_skipped');
  });

  it('keeps a Gaia bibcode where no 2p solution stands behind it', () => {
    // The record carries no Gaia astrometry row at all, so there is no fit to
    // distrust and the citation is ordinary.
    const res = resolvePmRescue({ ...NOTHING, simbad: cited({ bibcode: GAIA_EDR3 }), gaia: null });
    expect(res.via).toBe('simbad');
    expect(pmRa(res)).toBe(2314.8);
  });

  it('falls past a skipped CNS5 value to a literature SIMBAD one, naming the '
    + 'skip on the result', () => {
    const res = resolvePmRescue({
      ...NOTHING,
      cns5: cited({ bibcode: GAIA_EDR3 }),
      simbad: cited({ bibcode: FABRICIUS }),
    });
    expect(res.via).toBe('simbad');
    expect(res.refusals).toEqual([{ tier: 'cns5', reason: 'gaia_release' }]);
    expect(pmRescueOutcome(res)).toBe('simbad');
  });

  it('separates "refused" from "absent" so the residual reads honestly', () => {
    expect(pmRescueOutcome(resolvePmRescue(NOTHING))).toBe('none');
    expect(pmRescueOutcome(resolvePmRescue({ ...NOTHING, cns5: cited({ bibcode: GAIA_DR2 }) })))
      .toBe('gaia_bibcode_skipped');
  });

  it('carries a genuine zero PM through rather than routing on truthiness', () => {
    const tycho = resolvePmRescue({
      ...NOTHING, tycho2: tycho2Row({ pmRaMasyr: 0, pmDecMasyr: 0 }),
    });
    expect(tycho.via).toBe('tycho2');
    expect(pmRa(tycho)).toBe(0);

    const simbad = resolvePmRescue({ ...NOTHING, simbad: cited({ pmRaMasyr: 0, pmDecMasyr: 0 }) });
    expect(simbad.via).toBe('simbad');
    expect(pmRa(simbad)).toBe(0);
  });

  it('credits the no-motion residual to the zero velocity tier', () => {
    expect(VELOCITY_VIA_BY_PM_RESCUE.none).toBe('zero');
    expect(VELOCITY_VIA_BY_PM_RESCUE.tycho2).toBe('tycho2_pm');
    expect(VELOCITY_VIA_BY_PM_RESCUE.cns5).toBe('cns5_pm');
    expect(VELOCITY_VIA_BY_PM_RESCUE.simbad).toBe('simbad_pm');
  });
});
