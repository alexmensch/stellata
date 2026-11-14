import { describe, it, expect } from 'vitest';
import { CATALOG_SCENE_EPOCH } from '../../../src/catalog-format/record/catalog-pure';
import {
  DIRECTION_VIA_VALUES,
  GAIA_DR3_REF_EPOCH,
  HIP2_PM_DELTA_THRESHOLD_MASYR,
  HIP2_REF_EPOCH,
  SIMBAD_REF_EPOCH,
  directionOnPm,
  hip2PmDisagrees,
  resolveDirection,
  tycho2SolutionKind,
  type DirectionInputs,
  type DirectionSolution,
  type DirectionVia,
  type DirectionSources,
} from './direction-cascade';
import {
  TYCHO2_ICRS_EPOCH, TYCHO2_MEAN_EPOCH, type Tycho2Row,
} from '../tycho2-parse';
import { gaiaAstrometryRow } from '../sources/gaia-astrometry-fixture';
import { type GaiaAstrometryCatalogRow } from '../sources/gaia-astrometry-source';
import { GAIA_NSS } from '../sources/gaia-nss-source';
import { HIP2, type Hip2AstrometryRow } from '../sources/hip2-source';
import { hip2AstrometryRow } from '../sources/hip2-fixture';
import { TYCHO2 } from '../tycho2-source';
import { SIMBAD_VALUES } from '../simbad/simbad-values-source';
import { sourceRowRef, type SourceRowRef } from '../../util/sources/row-ref-pure';
import { cns5Astrometry } from '../classic-ids/cns5-fixture';
import {
  angularSeparationArcsec,
  directionAtEpoch,
  unitVectorFromRaDec,
  type UnitVector,
} from '../../../src/astro-core/equatorial-basis';

const SIMBAD_REF = sourceRowRef(SIMBAD_VALUES, 1);

const nssIndex = (sourceId: string): Map<string, SourceRowRef<string>> =>
  new Map([[sourceId, sourceRowRef(GAIA_NSS, sourceId)]]);

// The cascade returns a solution, not a direction — production advances it at
// the one call site in stars-parse, on the motion the row ends up with. These
// assertions want the tier's own advance, which is that call with the tier's
// own PM.
/** The resolved tier and its solution, flattened, or null on `none`. */
const solve = (
  i: Parameters<typeof resolveDirection>[0], s: Parameters<typeof resolveDirection>[1],
): (DirectionSolution & { via: DirectionVia }) | null => {
  const r = resolveDirection(i, s);
  return r.via === 'none' ? null : { via: r.via, ...r.value };
};

const dirOf = (s: DirectionSolution): UnitVector =>
  directionOnPm(s, s.srcPmraMasyr, s.srcPmdecMasyr);

function gaiaRow(overrides: Partial<GaiaAstrometryCatalogRow> = {}): GaiaAstrometryCatalogRow {
  return gaiaAstrometryRow({
    raDeg: 100, decDeg: 20,
    parallaxMas: 50,
    pmraMasyr: 10, pmdecMasyr: -10,
    ruwe: 1.0, ipdFracMultiPeak: 0,
    ...overrides,
  });
}

function hip2Row(overrides: Partial<Hip2AstrometryRow> = {}): Hip2AstrometryRow {
  return hip2AstrometryRow({
    raDeg: 100.001, decDeg: 20.001, plxMas: 50, pmRaMasyr: 10, pmDeMasyr: -10, ref: sourceRowRef(HIP2, 42), ...overrides,
  });
}

const TYC = '3694-2544-1';

function tycho2Row(overrides: Partial<Tycho2Row> = {}): Tycho2Row {
  return {
    raDeg: 33.5, decDeg: 12.25,
    epoch: TYCHO2_MEAN_EPOCH,
    pmRaMasyr: 10, pmDecMasyr: -10,
    btMag: 9.5, vtMag: 8.9,
    fromIcrs: false, isPhotocentre: false, hip: null,
    ref: sourceRowRef(TYCHO2, TYC),
    ...overrides,
  };
}

function sources(overrides: Partial<DirectionSources> = {}): DirectionSources {
  return {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nss: new Map(),
    tycho2: new Map(),
    cns5: new Map(),
    ...overrides,
  };
}

function inputs(overrides: Partial<DirectionInputs> = {}): DirectionInputs {
  return {
    sourceId: null, hip: null, tyc: null, gl: null, simbad: null,
    curated: null, ...overrides,
  };
}

describe('direction-cascade / tier epochs against SIMBAD', () => {
  it("pins Barnard's Star: Gaia DR3 J2016.0 → J2000.0 vs SIMBAD", () => {
    // Gaia DR3 4472832130942575872 (data/gaia/gaia_dr3_astrometry.tsv)
    // vs SIMBAD's J2000 ICRS position (itself Gaia-propagated). Pins the
    // propagation formula against an independent J2000 reference, so the
    // target epoch is a literal 2000 here — decoupled from
    // CATALOG_SCENE_EPOCH (now J2016.0, where the Gaia tier is a Δt=0
    // no-op and could not exercise the tangent/sign/cos δ math).
    const u = directionAtEpoch(
      { raDeg: 269.448502525, decDeg: 4.739420051 }, { pmRaMasyr: -801.5510, pmDecMasyr: 10362.3942 },
      GAIA_DR3_REF_EPOCH, 2000.0,
    );
    const simbad = unitVectorFromRaDec(269.4520769586187, 4.693364966576667);
    expect(angularSeparationArcsec(u, simbad)).toBeLessThan(0.1);
  });

  it('pins 61 Cyg A: HIP2 J1991.25 → J2000.0 vs SIMBAD', () => {
    // HIP 104214 from data/hipparcos/hip2_van_leeuwen.tsv. HIP2 vs
    // Gaia zero-point + 8.75 yr of PM error accumulate to ~0.1″; the
    // 0.25″ bound still catches any sign / cos δ convention error
    // (those are ≥ 10″ at this PM). Target epoch is a literal 2000 —
    // an independent-reference propagation pin, not the scene epoch.
    const u = directionAtEpoch(
      { raDeg: 316.71181137, decDeg: 38.74149513 }, { pmRaMasyr: 4168.31, pmDecMasyr: 3269.2 },
      HIP2_REF_EPOCH, 2000.0,
    );
    const simbad = unitVectorFromRaDec(316.7247482895925, 38.74941731943694);
    expect(angularSeparationArcsec(u, simbad)).toBeLessThan(0.25);
  });
});

describe('direction-cascade / gates', () => {
  it('hip2PmDisagrees trips on either axis alone, never on missing PMs', () => {
    const delta = HIP2_PM_DELTA_THRESHOLD_MASYR + 1;
    expect(hip2PmDisagrees(gaiaRow(), hip2Row())).toBe(false);
    expect(hip2PmDisagrees(gaiaRow({ pmraMasyr: 10 + delta }), hip2Row())).toBe(true);
    expect(hip2PmDisagrees(gaiaRow({ pmdecMasyr: -10 - delta }), hip2Row())).toBe(true);
    expect(hip2PmDisagrees(gaiaRow({ pmraMasyr: null }), hip2Row())).toBe(false);
    expect(hip2PmDisagrees(gaiaRow(), hip2Row({ pmDeMasyr: null }))).toBe(false);
  });
});

describe('direction-cascade / resolveDirection routing', () => {
  const SID = '4472832130942575872';

  it('clean Gaia 5p routes gaia_5p with the Gaia direction', () => {
    const g = gaiaRow();
    const res = solve(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
    }));
    expect(res?.via).toBe('gaia_5p');
    const expected = directionAtEpoch(
      { raDeg: g.raDeg, decDeg: g.decDeg }, { pmRaMasyr: g.pmraMasyr, pmDecMasyr: g.pmdecMasyr },
      GAIA_DR3_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angularSeparationArcsec(dirOf(res!), expected)).toBe(0);
  });

  it('NSS + unreliable 5p routes gaia_nss_systemic and keeps the Gaia direction', () => {
    const g = gaiaRow({ ruwe: 2.0 });
    const res = solve(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
      nss: nssIndex(SID),
    }));
    expect(res?.via).toBe('gaia_nss_systemic');
    const gaia5p = solve(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
    }));
    expect(angularSeparationArcsec(dirOf(res!), dirOf(gaia5p!))).toBe(0);
  });

  it('NSS membership alone (clean 5p) stays gaia_5p', () => {
    const res = solve(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow()]]),
      nss: nssIndex(SID),
    }));
    expect(res?.via).toBe('gaia_5p');
  });

  it('HIP2 PM discrepancy routes hip2_pm_discrepant with the HIP2 direction', () => {
    const h = hip2Row({ pmRaMasyr: 10 + HIP2_PM_DELTA_THRESHOLD_MASYR + 1 });
    const res = solve(inputs({ sourceId: SID, hip: 42 }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow()]]),
      hip2: new Map([[42, h]]),
    }));
    expect(res?.via).toBe('hip2_pm_discrepant');
    const expected = directionAtEpoch(
      { raDeg: h.raDeg, decDeg: h.decDeg }, { pmRaMasyr: h.pmRaMasyr, pmDecMasyr: h.pmDeMasyr },
      HIP2_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angularSeparationArcsec(dirOf(res!), expected)).toBe(0);
  });

  it('gaia_nss_systemic outranks hip2_pm_discrepant (stage3 priority order)', () => {
    const res = solve(inputs({ sourceId: SID, hip: 42 }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow({ ruwe: 2.0 })]]),
      hip2: new Map([[42, hip2Row({ pmRaMasyr: 500 })]]),
      nss: nssIndex(SID),
    }));
    expect(res?.via).toBe('gaia_nss_systemic');
  });

  it('no Gaia source → hip2_saturated', () => {
    const res = solve(inputs({ hip: 42 }), sources({
      hip2: new Map([[42, hip2Row()]]),
    }));
    expect(res?.via).toBe('hip2_saturated');
  });

  it('2p Gaia row (parallax null) with HIP2 cover → hip2_saturated', () => {
    const res = solve(inputs({ sourceId: SID, hip: 42 }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow({ parallaxMas: null })]]),
      hip2: new Map([[42, hip2Row()]]),
    }));
    expect(res?.via).toBe('hip2_saturated');
  });

  it('names the Gaia solution each HIP2 route passed over, and only those', () => {
    const refusalsOf = (gaia: GaiaAstrometryCatalogRow | null, hip2 = hip2Row()) =>
      resolveDirection(inputs({ sourceId: SID, hip: 42 }), sources({
        gaiaAstrometry: new Map(gaia === null ? [] : [[SID, gaia]]),
        hip2: new Map([[42, hip2]]),
      })).refusals;
    const clean = gaiaRow();
    expect(refusalsOf(clean, hip2Row({ pmRaMasyr: 10 + HIP2_PM_DELTA_THRESHOLD_MASYR + 1 })))
      .toEqual([{ tier: 'gaia_5p', reason: 'pm_disagrees_with_hip2', ref: clean.ref }]);
    const twoP = gaiaRow({ parallaxMas: null });
    expect(refusalsOf(twoP))
      .toEqual([{ tier: 'gaia_5p', reason: 'no_5p_solution', ref: twoP.ref }]);
    expect(refusalsOf(null)).toEqual([]);
    expect(refusalsOf(gaiaRow())).toEqual([]);
  });

  it('returns none, not a placeholder solution, where no tier reaches the row', () => {
    expect(resolveDirection(inputs(), sources())).toEqual({ via: 'none', refusals: [] });
  });

  it('answers a curated solution only once every tier has missed', () => {
    const curated = {
      srcRaDeg: 0, srcDecDeg: 0, srcEpoch: CATALOG_SCENE_EPOCH,
      srcPmraMasyr: null, srcPmdecMasyr: null, velVia: 'zero' as const,
    };
    expect(resolveDirection(inputs({ curated }), sources())).toEqual({
      via: 'curated', value: curated, evidence: [], refusals: [],
    });
    expect(resolveDirection(inputs({ sourceId: SID, curated }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow()]]),
    })).via).toBe('gaia_5p');
  });

  it('2p Gaia row without HIP2 falls through to gaia_2p, unpropagated when PM is null', () => {
    const g = gaiaRow({ parallaxMas: null, pmraMasyr: null, pmdecMasyr: null });
    const res = solve(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
    }));
    expect(res?.via).toBe('gaia_2p');
    expect(angularSeparationArcsec(dirOf(res!), unitVectorFromRaDec(g.raDeg, g.decDeg))).toBe(0);
  });

  it('Tycho-2 takes the row Gaia and HIP2 both miss, on its own TYC', () => {
    const t = tycho2Row();
    const res = solve(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, t]]),
    }));
    expect(res?.via).toBe('tycho2');
    expect(res?.velVia).toBe('tycho2_pm');
    expect(res?.srcRaDeg).toBe(t.raDeg);
  });

  it('Tycho-2 advances its mean position from J2000, not from ep_ra/ep_de', () => {
    // The regression this pins: ep_ra/ep_de date the OBSERVATIONS behind the
    // mean solution, and the position they produced is stated at J2000.
    // Reading them as the position's epoch advances every row by an extra
    // 2000 - ep_ra, which reaches 81.7 years on this table.
    const t = tycho2Row({ pmRaMasyr: 0, pmDecMasyr: 3600_000 });  // 1 deg/yr in Dec
    const res = solve(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, t]]),
    }))!;
    expect(res.srcEpoch).toBe(TYCHO2_MEAN_EPOCH);
    const advanced = dirOf(res);
    const fromJ2000 = directionAtEpoch(
      { raDeg: t.raDeg, decDeg: t.decDeg }, { pmRaMasyr: t.pmRaMasyr, pmDecMasyr: t.pmDecMasyr },
      TYCHO2_MEAN_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angularSeparationArcsec(advanced, fromJ2000)).toBe(0);
    // The fixture's own ep_ra, read as the position's epoch, adds 8.93 yr of
    // this PM. Pinned exactly rather than bounded: a loose floor here would
    // still pass on a one-year epoch error, which is the regression itself.
    // The tangent displacement is applied before renormalisation, so a
    // finished angle is atan(d) — at this displacement that compresses the
    // 8.93 degrees rather than losing it. Don't "correct" toward 32148".
    const fromObservationEpoch = directionAtEpoch(
      { raDeg: t.raDeg, decDeg: t.decDeg }, { pmRaMasyr: t.pmRaMasyr, pmDecMasyr: t.pmDecMasyr },
      1991.07, CATALOG_SCENE_EPOCH,
    );
    expect(angularSeparationArcsec(advanced, fromObservationEpoch)).toBeCloseTo(28482.604, 2);
  });

  it("a Tycho-2 row with no PM keeps its position and zeroes the tangential term", () => {
    const res = solve(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, tycho2Row({ pmRaMasyr: null, pmDecMasyr: null })]]),
    }));
    expect(res?.via).toBe('tycho2');
    expect(res?.velVia).toBe('zero');
  });

  it('CNS5 takes a TYC-less Gliese row, propagating from its own pos_epoch', () => {
    const res = solve(inputs({ gl: 'Gl 165A' }), sources({
      cns5: new Map([['165A', cns5Astrometry()]]),
    }));
    expect(res?.via).toBe('cns5');
    expect(res?.velVia).toBe('cns5_pm');
  });

  it('Tycho-2 outranks CNS5 on a row carrying both', () => {
    const res = solve(inputs({ tyc: TYC, gl: 'Gl 165A' }), sources({
      tycho2: new Map([[TYC, tycho2Row()]]),
      cns5: new Map([['165A', cns5Astrometry()]]),
    }));
    expect(res?.via).toBe('tycho2');
  });

  it('SIMBAD is the bottom tier and propagates from J2000', () => {
    const simbad = {
      raDeg: 120, decDeg: 40, cooBibcode: '2020yCat.1350....0G',
      pm: { pmRaMasyr: 200, pmDecMasyr: -100, bibcode: '2020yCat.1350....0G', ref: SIMBAD_REF },
      ref: SIMBAD_REF,
    };
    const res = solve(inputs({ simbad }), sources())!;
    expect(res.via).toBe('simbad');
    expect(res.velVia).toBe('simbad_pm');
    const expected = directionAtEpoch(
      { raDeg: simbad.raDeg, decDeg: simbad.decDeg }, { pmRaMasyr: simbad.pm.pmRaMasyr, pmDecMasyr: simbad.pm.pmDecMasyr },
      SIMBAD_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angularSeparationArcsec(dirOf(res), expected)).toBe(0);
  });

  it('a SIMBAD row with a position but no PM keeps the position, zero tangential', () => {
    const res = solve(inputs({
      simbad: {
        raDeg: 120, decDeg: 40, cooBibcode: '2020yCat.1350....0G', pm: null, ref: SIMBAD_REF,
      },
    }), sources())!;
    expect(res.via).toBe('simbad');
    expect(res.velVia).toBe('zero');
    expect(angularSeparationArcsec(dirOf(res), unitVectorFromRaDec(120, 40))).toBe(0);
  });

  it('no tier reaches the row → null, which the walk counts as a dropped record', () => {
    expect(solve(inputs(), sources())).toBeNull();
    expect(solve(inputs({ tyc: 'not-a-tyc', gl: 'Gl 9999' }), sources()))
      .toBeNull();
  });

  it('DIRECTION_VIA_VALUES covers every emitted tag', () => {
    expect(DIRECTION_VIA_VALUES).toEqual([
      'gaia_5p',
      'gaia_2p',
      'gaia_nss_systemic',
      'hip2_saturated',
      'hip2_pm_discrepant',
      'tycho2',
      'cns5',
      'simbad',
      'curated',
    ]);
  });
});

describe('resolveDirection velocity solution', () => {
  const gaiaRow = gaiaAstrometryRow({
    raDeg: 10, decDeg: 20, parallaxMas: 50,
    pmraMasyr: 100, pmdecMasyr: -40, ruwe: 1.0, ipdFracMultiPeak: 0, gMag: 8,
  });

  it('carries the Gaia solution + gaia_pm velVia on the gaia_5p tier', () => {
    const sources: DirectionSources = {
      gaiaAstrometry: new Map([['1', gaiaRow]]),
      hip2: new Map(), nss: new Map(),
      tycho2: new Map(), cns5: new Map(),
    };
    const r = solve(inputs({ sourceId: '1' }), sources)!;
    expect(r.via).toBe('gaia_5p');
    expect(r.srcRaDeg).toBe(10);
    expect(r.srcPmraMasyr).toBe(100);
    expect(r.velVia).toBe('gaia_pm');
  });

  it('a 2p Gaia row (null PM) routes velocity to zero', () => {
    const twoP: GaiaAstrometryCatalogRow = {
      ...gaiaRow, pmraMasyr: null, pmdecMasyr: null,
    };
    const sources: DirectionSources = {
      gaiaAstrometry: new Map([['1', twoP]]),
      hip2: new Map(), nss: new Map(),
      tycho2: new Map(), cns5: new Map(),
    };
    const r = solve(inputs({ sourceId: '1' }), sources)!;
    expect(r.velVia).toBe('zero');
  });

  it('the Tycho-2 tier carries its own solution + tycho2_pm velVia', () => {
    const sources: DirectionSources = {
      gaiaAstrometry: new Map(), hip2: new Map(), nss: new Map(),
      tycho2: new Map([[TYC, tycho2Row({ pmRaMasyr: 12, pmDecMasyr: -8 })]]),
      cns5: new Map(),
    };
    const r = solve(inputs({ tyc: TYC }), sources)!;
    expect(r.via).toBe('tycho2');
    expect(r.srcPmraMasyr).toBe(12);
    expect(r.velVia).toBe('tycho2_pm');
  });
});

describe('direction-cascade / directionOnPm', () => {
  // TYC 1269-128-1 (HD 285742, 52.6 pc), the nearest of the three Tycho-2 rows
  // with no mean solution: supplement 1 states only the observed cell and no
  // PM, and the rescue cascade reaches it on SIMBAD's bibcoded motion. That
  // cell is at J1991.25, so it advances over 24.75 yr where SIMBAD's J2000 one
  // advances over 16.
  const TYCHO2_OBSERVED_RA = 66.25076035;
  const TYCHO2_OBSERVED_DEC = 16.9849519;
  const SIMBAD_J2000_RA = 66.25102960285;
  const SIMBAD_J2000_DEC = 16.98489746366;
  const RESCUED_PMRA = 91.121;
  const RESCUED_PMDEC = -24.707;
  // Where the tier's own PM is null the advance is the identity, so the raw
  // observed cell is what the row ships without a rescued motion. Named rather
  // than re-derived through the cascade: an assertion against the same call it
  // is testing proves nothing.
  const TYCHO2_OBSERVED_DIR = unitVectorFromRaDec(TYCHO2_OBSERVED_RA, TYCHO2_OBSERVED_DEC);

  const noMeanSolution = (): DirectionSolution => solve(
    inputs({ tyc: TYC }),
    sources({
      tycho2: new Map([[TYC, tycho2Row({
        raDeg: TYCHO2_OBSERVED_RA, decDeg: TYCHO2_OBSERVED_DEC,
        epoch: TYCHO2_ICRS_EPOCH, pmRaMasyr: null, pmDecMasyr: null,
        fromIcrs: true,
      })]]),
    }),
  )!;

  it('advances the observed tier position over the rescued PM', () => {
    const res = noMeanSolution();
    expect(res.srcEpoch).toBe(TYCHO2_ICRS_EPOCH);
    expect(res.velVia).toBe('zero');
    const advanced = directionOnPm(res, RESCUED_PMRA, RESCUED_PMDEC);
    // 24.75 yr of this star's 94.4 mas/yr motion.
    expect(angularSeparationArcsec(TYCHO2_OBSERVED_DIR, advanced)).toBeCloseTo(2.3367, 3);
  });

  it('leaves only the two catalogues frame disagreement, once both reach J2016', () => {
    // The rescued PM is SIMBAD's, and SIMBAD states its own J2000 position, so
    // advancing that one to the scene epoch is an independent estimate of where
    // the star is. Both sides now start from the epoch their own catalogue
    // states — Tycho-2 J1991.25, SIMBAD J2000 — so the epoch term cancels and
    // the frame disagreement is all that survives. That identity, not the
    // absolute residual, is what says the advance is applied correctly.
    const res = noMeanSolution();
    const advanced = directionOnPm(res, RESCUED_PMRA, RESCUED_PMDEC);
    const simbadJ2016 = directionAtEpoch(
      { raDeg: SIMBAD_J2000_RA, decDeg: SIMBAD_J2000_DEC }, { pmRaMasyr: RESCUED_PMRA, pmDecMasyr: RESCUED_PMDEC },
      SIMBAD_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    // Tycho-2's own cell carried to J2000 on the same motion, so the two are
    // compared at one epoch rather than across a 8.75 yr gap.
    const tychoAtJ2000 = directionAtEpoch(
      { raDeg: TYCHO2_OBSERVED_RA, decDeg: TYCHO2_OBSERVED_DEC }, { pmRaMasyr: RESCUED_PMRA, pmDecMasyr: RESCUED_PMDEC },
      TYCHO2_ICRS_EPOCH, SIMBAD_REF_EPOCH,
    );
    const frameDisagreement = angularSeparationArcsec(
      tychoAtJ2000, unitVectorFromRaDec(SIMBAD_J2000_RA, SIMBAD_J2000_DEC),
    );
    expect(frameDisagreement).toBeCloseTo(0.1313, 3);
    // Exact only to the linear form's second-order term (~5 µas here, since
    // the tangent-plane advance is not an isometry); do not tighten.
    expect(angularSeparationArcsec(advanced, simbadJ2016)).toBeCloseTo(frameDisagreement, 4);
    // Comparing the raw cells across the epoch gap instead reads 0.9475" — 7x
    // the real disagreement, and the number the position-source question was
    // once weighed on.
    expect(angularSeparationArcsec(
      TYCHO2_OBSERVED_DIR, unitVectorFromRaDec(SIMBAD_J2000_RA, SIMBAD_J2000_DEC),
    )).toBeCloseTo(0.9475, 3);
  });

  it('is a no-op where the rescue reaches no PM, whatever the tier epoch', () => {
    const res = noMeanSolution();
    expect(angularSeparationArcsec(TYCHO2_OBSERVED_DIR, directionOnPm(res, null, null)))
      .toBeCloseTo(0, 9);
  });

  it('is a zero-dt no-op on the Gaia tier, which already states J2016.0', () => {
    // The 273 Gaia 2p rows are the bulk of the rescue cohort and none of them
    // may move: their position is native to the scene epoch.
    const g = gaiaRow({ parallaxMas: null, pmraMasyr: null, pmdecMasyr: null });
    const res = solve(inputs({ sourceId: '1' }), sources({
      gaiaAstrometry: new Map([['1', g]]),
    }))!;
    expect(res.velVia).toBe('zero');
    expect(angularSeparationArcsec(
      unitVectorFromRaDec(g.raDeg, g.decDeg), directionOnPm(res, 500, -500),
    )).toBeCloseTo(0, 9);
  });

  it('advances a mean solution from J2000 over the rescued PM', () => {
    const res = solve(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, tycho2Row({ pmRaMasyr: null, pmDecMasyr: null })]]),
    }))!;
    expect(res.srcEpoch).toBe(TYCHO2_MEAN_EPOCH);
    const advanced = directionOnPm(res, 0, 3600_000);   // 1 deg/yr in Dec alone
    const fromJ2000 = directionAtEpoch(
      { raDeg: res.srcRaDeg, decDeg: res.srcDecDeg }, { pmRaMasyr: 0, pmDecMasyr: 3600_000 },
      TYCHO2_MEAN_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(advanced.x).toBeCloseTo(fromJ2000.x, 12);
    expect(advanced.y).toBeCloseTo(fromJ2000.y, 12);
    expect(advanced.z).toBeCloseTo(fromJ2000.z, 12);
    // Same counter-assertion as the routing suite's, on the rescued-PM path:
    // the rescue must not reintroduce the observation epoch.
    expect(angularSeparationArcsec(advanced, directionAtEpoch(
      { raDeg: res.srcRaDeg, decDeg: res.srcDecDeg }, { pmRaMasyr: 0, pmDecMasyr: 3600_000 },
      1991.07, CATALOG_SCENE_EPOCH,
    ))).toBeCloseTo(28482.604, 2);
  });
});

describe('tycho2SolutionKind', () => {
  it('reads an observed position as observed, whatever the photocentre flag says', () => {
    expect(tycho2SolutionKind({ fromIcrs: false, isPhotocentre: false })).toBe('mean');
    expect(tycho2SolutionKind({ fromIcrs: false, isPhotocentre: true })).toBe('photocentre');
    expect(tycho2SolutionKind({ fromIcrs: true, isPhotocentre: false })).toBe('observed');
    expect(tycho2SolutionKind({ fromIcrs: true, isPhotocentre: true })).toBe('observed');
  });
});
