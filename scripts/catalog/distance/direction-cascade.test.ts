import { describe, it, expect } from 'vitest';
import {
  CATALOG_SCENE_EPOCH,
  DIRECTION_VIA_VALUES,
  GAIA_DR3_REF_EPOCH,
  GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD,
  GAIA_RUWE_UNRELIABLE_THRESHOLD,
  HIP2_PM_DELTA_THRESHOLD_MASYR,
  HIP2_REF_EPOCH,
  KM_S_TO_PC_YR,
  SIMBAD_REF_EPOCH,
  directionAtEpoch,
  directionAtEpochSplit,
  gaia5pUnreliable,
  hip2PmDisagrees,
  parseGaiaAstrometryCatalogTsv,
  parseHip2Tsv,
  parseNssSourceIdSet,
  resolveDirection,
  velocityPcPerYr,
  type DirectionInputs,
  type DirectionSources,
  type GaiaAstrometryCatalogRow,
  type Hip2AstrometryRow,
} from './direction-cascade';
import type { Tycho2Row } from '../tycho2-parse';
import { gaiaAstrometryRow } from './astrometry-fixture';
import { cns5Astrometry } from '../classic-ids/cns5-fixture';
import {
  equatorialTangentBasis,
  unitVectorFromRaDec,
  type UnitVector,
} from '../../../src/client/util/equatorial-basis';

const ARCSEC_PER_RAD = (180 * 3600) / Math.PI;

function angSepArcsec(a: UnitVector, b: UnitVector): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot) * ARCSEC_PER_RAD;
}

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
  return {
    raDeg: 100.001, decDeg: 20.001,
    plxMas: 50, plxErrorMas: null,
    pmRaMasyr: 10, pmDeMasyr: -10,
    ...overrides,
  };
}

const TYC = '3694-2544-1';

function tycho2Row(overrides: Partial<Tycho2Row> = {}): Tycho2Row {
  return {
    raDeg: 33.5, decDeg: 12.25,
    epochRa: 1991.07, epochDec: 1991.00,
    pmRaMasyr: 10, pmDecMasyr: -10,
    btMag: 9.5, vtMag: 8.9,
    fromIcrs: false, isPhotocentre: false,
    ...overrides,
  };
}

function sources(overrides: Partial<DirectionSources> = {}): DirectionSources {
  return {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nssSourceIds: new Set(),
    tycho2: new Map(),
    cns5: new Map(),
    ...overrides,
  };
}

function inputs(overrides: Partial<DirectionInputs> = {}): DirectionInputs {
  return {
    sourceId: null, hip: null, tyc: null, gl: null, simbad: null,
    isSol: false, ...overrides,
  };
}

describe('direction-cascade / unitVectorFromRaDec', () => {
  it('maps the equatorial basis axes', () => {
    const a = unitVectorFromRaDec(0, 0);
    expect(a.x).toBeCloseTo(1, 12);
    expect(a.y).toBeCloseTo(0, 12);
    expect(a.z).toBeCloseTo(0, 12);
    const b = unitVectorFromRaDec(90, 0);
    expect(b.x).toBeCloseTo(0, 12);
    expect(b.y).toBeCloseTo(1, 12);
    expect(b.z).toBeCloseTo(0, 12);
    const c = unitVectorFromRaDec(0, 90);
    expect(c.x).toBeCloseTo(0, 12);
    expect(c.y).toBeCloseTo(0, 12);
    expect(c.z).toBeCloseTo(1, 12);
  });

  it('south pole lands at -z (dec sign is not flipped)', () => {
    const s = unitVectorFromRaDec(123, -90);
    expect(s.z).toBeCloseTo(-1, 12);
  });
});

describe('direction-cascade / directionAtEpoch', () => {
  it('returns the measured direction unchanged when either PM is missing', () => {
    const u = directionAtEpoch(100, 20, null, -10, 2016, 2000);
    const v = directionAtEpoch(100, 20, 10, null, 2016, 2000);
    const raw = unitVectorFromRaDec(100, 20);
    expect(angSepArcsec(u, raw)).toBe(0);
    expect(angSepArcsec(v, raw)).toBe(0);
  });

  it('positive pmra moves east (+RA), positive pmdec moves north (+Dec)', () => {
    // 1000 mas/yr over +10 yr = 10″. At (0, 0) east is +y, north is +z.
    const east = directionAtEpoch(0, 0, 1000, 0, 2000, 2010);
    expect(east.y).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 12);
    expect(angSepArcsec(east, unitVectorFromRaDec(0, 0))).toBeCloseTo(10, 6);

    const north = directionAtEpoch(0, 0, 0, 1000, 2000, 2010);
    expect(north.z).toBeGreaterThan(0);
    expect(north.y).toBeCloseTo(0, 12);
    expect(angSepArcsec(north, unitVectorFromRaDec(0, 0))).toBeCloseTo(10, 6);
  });

  it('backwards propagation (toEpoch < fromEpoch) flips the displacement sign', () => {
    const fwd = directionAtEpoch(0, 0, 1000, 0, 2000, 2016);
    const back = directionAtEpoch(0, 0, 1000, 0, 2016, 2000);
    expect(fwd.y).toBeGreaterThan(0);
    expect(back.y).toBeLessThan(0);
  });

  it('pmra is the cos δ-applied on-sky rate: displacement is dec-independent', () => {
    // If the implementation wrongly divided (or multiplied) by cos δ,
    // the on-sky displacement at dec 60° would be 2× (or ½×) the
    // equatorial one.
    const atEquator = angSepArcsec(
      directionAtEpoch(0, 0, 500, 0, 2000, 2010),
      unitVectorFromRaDec(0, 0),
    );
    const atDec60 = angSepArcsec(
      directionAtEpoch(0, 60, 500, 0, 2000, 2010),
      unitVectorFromRaDec(0, 60),
    );
    expect(atDec60).toBeCloseTo(atEquator, 5);
  });

  it('round-trips through an epoch and back', () => {
    const there = directionAtEpoch(269.45, 4.74, -801.551, 10362.394, 2016, 2000);
    // Convert back to (ra, dec) and re-propagate with the same PM.
    const raBack = (Math.atan2(there.y, there.x) * 180) / Math.PI;
    const decBack = (Math.asin(there.z) * 180) / Math.PI;
    const home = directionAtEpoch(raBack, decBack, -801.551, 10362.394, 2000, 2016);
    expect(angSepArcsec(home, unitVectorFromRaDec(269.45, 4.74))).toBeLessThan(0.001);
  });

  it('stays finite and unit-length near the celestial pole', () => {
    const u = directionAtEpoch(10, 89.95, 5000, 2000, 2000, 2016);
    const norm = Math.hypot(u.x, u.y, u.z);
    expect(norm).toBeCloseTo(1, 12);
  });

  it("pins Barnard's Star: Gaia DR3 J2016.0 → J2000.0 vs SIMBAD", () => {
    // Gaia DR3 4472832130942575872 (data/gaia/gaia_dr3_astrometry_catalog.tsv)
    // vs SIMBAD's J2000 ICRS position (itself Gaia-propagated). Pins the
    // propagation formula against an independent J2000 reference, so the
    // target epoch is a literal 2000 here — decoupled from
    // CATALOG_SCENE_EPOCH (now J2016.0, where the Gaia tier is a Δt=0
    // no-op and could not exercise the tangent/sign/cos δ math).
    const u = directionAtEpoch(
      269.448502525, 4.739420051, -801.5510, 10362.3942,
      GAIA_DR3_REF_EPOCH, 2000.0,
    );
    const simbad = unitVectorFromRaDec(269.4520769586187, 4.693364966576667);
    expect(angSepArcsec(u, simbad)).toBeLessThan(0.1);
  });

  it('pins 61 Cyg A: HIP2 J1991.25 → J2000.0 vs SIMBAD', () => {
    // HIP 104214 from data/hipparcos/hip2_van_leeuwen.tsv. HIP2 vs
    // Gaia zero-point + 8.75 yr of PM error accumulate to ~0.1″; the
    // 0.25″ bound still catches any sign / cos δ convention error
    // (those are ≥ 10″ at this PM). Target epoch is a literal 2000 —
    // an independent-reference propagation pin, not the scene epoch.
    const u = directionAtEpoch(
      316.71181137, 38.74149513, 4168.31, 3269.2,
      HIP2_REF_EPOCH, 2000.0,
    );
    const simbad = unitVectorFromRaDec(316.7247482895925, 38.74941731943694);
    expect(angSepArcsec(u, simbad)).toBeLessThan(0.25);
  });
});

describe('direction-cascade / gates', () => {
  it('gaia5pUnreliable fires on either indicator, tolerates nulls', () => {
    expect(gaia5pUnreliable(gaiaRow())).toBe(false);
    expect(gaia5pUnreliable(gaiaRow({ ruwe: GAIA_RUWE_UNRELIABLE_THRESHOLD + 0.01 }))).toBe(true);
    expect(gaia5pUnreliable(gaiaRow({
      ipdFracMultiPeak: GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD + 0.01,
    }))).toBe(true);
    expect(gaia5pUnreliable(gaiaRow({ ruwe: null, ipdFracMultiPeak: null }))).toBe(false);
  });

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
    const res = resolveDirection(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
    }));
    expect(res?.via).toBe('gaia_5p');
    const expected = directionAtEpoch(
      g.raDeg, g.decDeg, g.pmraMasyr, g.pmdecMasyr,
      GAIA_DR3_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angSepArcsec(res!.dir, expected)).toBe(0);
  });

  it('NSS + unreliable 5p routes gaia_nss_systemic and keeps the Gaia direction', () => {
    const g = gaiaRow({ ruwe: 2.0 });
    const res = resolveDirection(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
      nssSourceIds: new Set([SID]),
    }));
    expect(res?.via).toBe('gaia_nss_systemic');
    const gaia5p = resolveDirection(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
    }));
    expect(angSepArcsec(res!.dir, gaia5p!.dir)).toBe(0);
  });

  it('NSS membership alone (clean 5p) stays gaia_5p', () => {
    const res = resolveDirection(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow()]]),
      nssSourceIds: new Set([SID]),
    }));
    expect(res?.via).toBe('gaia_5p');
  });

  it('HIP2 PM discrepancy routes hip2_pm_discrepant with the HIP2 direction', () => {
    const h = hip2Row({ pmRaMasyr: 10 + HIP2_PM_DELTA_THRESHOLD_MASYR + 1 });
    const res = resolveDirection(inputs({ sourceId: SID, hip: 42 }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow()]]),
      hip2: new Map([[42, h]]),
    }));
    expect(res?.via).toBe('hip2_pm_discrepant');
    const expected = directionAtEpoch(
      h.raDeg, h.decDeg, h.pmRaMasyr, h.pmDeMasyr,
      HIP2_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    // Identical inputs → identical direction. Compared component-wise:
    // angSepArcsec's acos floors at ~0.004″ for a unit vector against
    // itself (self-dot rounds to 1−1 ULP), which the larger 24.75 yr
    // HIP2 Δt now surfaces.
    expect(res!.dir.x).toBeCloseTo(expected.x, 12);
    expect(res!.dir.y).toBeCloseTo(expected.y, 12);
    expect(res!.dir.z).toBeCloseTo(expected.z, 12);
  });

  it('gaia_nss_systemic outranks hip2_pm_discrepant (stage3 priority order)', () => {
    const res = resolveDirection(inputs({ sourceId: SID, hip: 42 }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow({ ruwe: 2.0 })]]),
      hip2: new Map([[42, hip2Row({ pmRaMasyr: 500 })]]),
      nssSourceIds: new Set([SID]),
    }));
    expect(res?.via).toBe('gaia_nss_systemic');
  });

  it('no Gaia source → hip2_saturated', () => {
    const res = resolveDirection(inputs({ hip: 42 }), sources({
      hip2: new Map([[42, hip2Row()]]),
    }));
    expect(res?.via).toBe('hip2_saturated');
  });

  it('2p Gaia row (parallax null) with HIP2 cover → hip2_saturated', () => {
    const res = resolveDirection(inputs({ sourceId: SID, hip: 42 }), sources({
      gaiaAstrometry: new Map([[SID, gaiaRow({ parallaxMas: null })]]),
      hip2: new Map([[42, hip2Row()]]),
    }));
    expect(res?.via).toBe('hip2_saturated');
  });

  it('2p Gaia row without HIP2 falls through to gaia_5p, unpropagated when PM is null', () => {
    const g = gaiaRow({ parallaxMas: null, pmraMasyr: null, pmdecMasyr: null });
    const res = resolveDirection(inputs({ sourceId: SID }), sources({
      gaiaAstrometry: new Map([[SID, g]]),
    }));
    expect(res?.via).toBe('gaia_5p');
    expect(angSepArcsec(res!.dir, unitVectorFromRaDec(g.raDeg, g.decDeg))).toBe(0);
  });

  it('Tycho-2 takes the row Gaia and HIP2 both miss, on its own TYC', () => {
    const t = tycho2Row();
    const res = resolveDirection(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, t]]),
    }));
    expect(res?.via).toBe('tycho2');
    expect(res?.velVia).toBe('tycho2_pm');
    expect(res?.srcRaDeg).toBe(t.raDeg);
  });

  it('Tycho-2 advances each coordinate over its OWN mean epoch', () => {
    // ep_ra and ep_de differ by a year, so collapsing them onto one epoch
    // moves Dec over the wrong baseline — the failure this tier's split
    // propagation exists to prevent.
    const t = tycho2Row({
      epochRa: 1990.0, epochDec: 1991.0,
      pmRaMasyr: 0, pmDecMasyr: 3600_000,   // 1°/yr in Dec, none in RA
    });
    const res = resolveDirection(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, t]]),
    }))!;
    const expected = directionAtEpochSplit(
      t.raDeg, t.decDeg, t.pmRaMasyr, t.pmDecMasyr,
      1990.0, 1991.0, CATALOG_SCENE_EPOCH,
    );
    expect(res.dir.z).toBeCloseTo(expected.z, 12);
    const collapsed = directionAtEpoch(
      t.raDeg, t.decDeg, t.pmRaMasyr, t.pmDecMasyr, 1990.0, CATALOG_SCENE_EPOCH,
    );
    // Collapsing the pair advances Dec over 26 yr instead of 25, so the
    // tangent displacement differs by exactly 1°. On the sphere that lands at
    // 0.8347°: the displacement is applied in the tangent plane and then
    // renormalised, so a finished angle is atan(d) — at a 25° displacement,
    // far outside the linear regime this PM was chosen to escape, that
    // compresses the degree rather than losing it. Don't "correct" to 3600.
    expect(angSepArcsec(res.dir, collapsed)).toBeCloseTo(3004.792, 2);
  });

  it("a Tycho-2 row with no PM keeps its position and zeroes the tangential term", () => {
    const res = resolveDirection(inputs({ tyc: TYC }), sources({
      tycho2: new Map([[TYC, tycho2Row({ pmRaMasyr: null, pmDecMasyr: null })]]),
    }));
    expect(res?.via).toBe('tycho2');
    expect(res?.velVia).toBe('zero');
  });

  it('CNS5 takes a TYC-less Gliese row, propagating from its own pos_epoch', () => {
    const res = resolveDirection(inputs({ gl: 'Gl 165A' }), sources({
      cns5: new Map([['165A', cns5Astrometry()]]),
    }));
    expect(res?.via).toBe('cns5');
    expect(res?.velVia).toBe('cns5_pm');
  });

  it('Tycho-2 outranks CNS5 on a row carrying both', () => {
    const res = resolveDirection(inputs({ tyc: TYC, gl: 'Gl 165A' }), sources({
      tycho2: new Map([[TYC, tycho2Row()]]),
      cns5: new Map([['165A', cns5Astrometry()]]),
    }));
    expect(res?.via).toBe('tycho2');
  });

  it('SIMBAD is the bottom tier and propagates from J2000', () => {
    const simbad = {
      raDeg: 120, decDeg: 40, cooBibcode: '2020yCat.1350....0G',
      pmRaMasyr: 200, pmDecMasyr: -100, pmBibcode: '2020yCat.1350....0G',
    };
    const res = resolveDirection(inputs({ simbad }), sources())!;
    expect(res.via).toBe('simbad');
    expect(res.velVia).toBe('simbad_pm');
    const expected = directionAtEpoch(
      simbad.raDeg, simbad.decDeg, simbad.pmRaMasyr, simbad.pmDecMasyr,
      SIMBAD_REF_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(res.dir.x).toBeCloseTo(expected.x, 12);
    expect(res.dir.y).toBeCloseTo(expected.y, 12);
    expect(res.dir.z).toBeCloseTo(expected.z, 12);
  });

  it('a SIMBAD row with a position but no PM keeps the position, zero tangential', () => {
    const res = resolveDirection(inputs({
      simbad: {
        raDeg: 120, decDeg: 40, cooBibcode: '2020yCat.1350....0G',
        pmRaMasyr: null, pmDecMasyr: null, pmBibcode: null,
      },
    }), sources())!;
    expect(res.via).toBe('simbad');
    expect(res.velVia).toBe('zero');
    // Component-wise: angSepArcsec's acos floors near 0.004″ for a unit
    // vector against itself, as the hip2_pm_discrepant case above notes.
    const unpropagated = unitVectorFromRaDec(120, 40);
    expect(res.dir.x).toBeCloseTo(unpropagated.x, 12);
    expect(res.dir.y).toBeCloseTo(unpropagated.y, 12);
    expect(res.dir.z).toBeCloseTo(unpropagated.z, 12);
  });

  it('no tier reaches the row → null, which the walk counts as a dropped record', () => {
    expect(resolveDirection(inputs(), sources())).toBeNull();
    expect(resolveDirection(inputs({ tyc: 'not-a-tyc', gl: 'Gl 9999' }), sources()))
      .toBeNull();
  });

  it('DIRECTION_VIA_VALUES covers every emitted tag', () => {
    expect(DIRECTION_VIA_VALUES).toEqual([
      'gaia_5p',
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

describe('direction-cascade / TSV parsers', () => {
  it('parseGaiaAstrometryCatalogTsv decodes rows and null cells', () => {
    const tsv = [
      'source_id\tra\tra_error\tdec\tdec_error\tparallax\tparallax_error\tpmra\tpmra_error\tpmdec\tpmdec_error\tref_epoch\truwe\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag\tphot_rp_mean_mag\tradial_velocity\tradial_velocity_error',
      '123\t100.5\t0.1\t-20.25\t0.1\t50.0\t0.1\t10.5\t0.1\t-3.5\t0.1\t2016.0\t1.2\t0\t8.0\t8.6\t7.3\t-110.51\t0.22',
      '456\t200.0\t\t30.0\t\t\t\t\t\t\t\t2016.0\t\t\t9.0\t\t\t\t',
      '',
    ].join('\n');
    const map = parseGaiaAstrometryCatalogTsv(tsv);
    expect(map.size).toBe(2);
    expect(map.get('123')).toEqual({
      raDeg: 100.5, decDeg: -20.25,
      parallaxMas: 50.0, parallaxErrorMas: 0.1,
      pmraMasyr: 10.5, pmdecMasyr: -3.5,
      ruwe: 1.2, ipdFracMultiPeak: 0,
      gMag: 8.0, bpMag: 8.6, rpMag: 7.3,
      radialVelocityKmS: -110.51,
      radialVelocityErrorKmS: 0.22,
    });
    expect(map.get('456')).toEqual({
      raDeg: 200.0, decDeg: 30.0,
      parallaxMas: null, parallaxErrorMas: null,
      pmraMasyr: null, pmdecMasyr: null,
      ruwe: null, ipdFracMultiPeak: null,
      gMag: 9.0, bpMag: null, rpMag: null,
      radialVelocityKmS: null,
      radialVelocityErrorKmS: null,
    });
  });

  it('parseGaiaAstrometryCatalogTsv throws on a missing column', () => {
    expect(() => parseGaiaAstrometryCatalogTsv('source_id\tra\tdec\n')).toThrow(/missing required columns/);
  });

  it('parseHip2Tsv decodes rows keyed by HIP', () => {
    const tsv = [
      'hip\tra_icrs\tde_icrs\tplx\te_plx\tpm_ra\tpm_de\te_pm_ra\te_pm_de\tgoodness_of_fit\tn_transits',
      '32349\t101.28854105\t-16.71314306\t379.21\t1.58\t-546.01\t-1223.07\t1.33\t1.24\t0.99\t100',
      '\t\t\t\t\t\t\t\t\t\t',
    ].join('\n');
    const map = parseHip2Tsv(tsv);
    expect(map.size).toBe(1);
    expect(map.get(32349)).toEqual({
      raDeg: 101.28854105, decDeg: -16.71314306,
      plxMas: 379.21, plxErrorMas: 1.58,
      pmRaMasyr: -546.01, pmDeMasyr: -1223.07,
    });
  });

  it('parseNssSourceIdSet collects the source_id column', () => {
    const tsv = [
      'source_id\tnss_solution_type\tperiod',
      '111\tOrbital\t500',
      '111\tSB1\t500',
      '222\tEclipsingBinary\t3',
    ].join('\n');
    const set = parseNssSourceIdSet(tsv);
    expect(set.size).toBe(2);
    expect(set.has('111')).toBe(true);
    expect(set.has('222')).toBe(true);
  });
});

const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);

function dot(a: UnitVector, b: UnitVector): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function norm(a: UnitVector): number {
  return Math.hypot(a.x, a.y, a.z);
}

describe('equatorialTangentBasis', () => {
  it('is orthonormal away from and adjacent to the pole and on RA-wrap', () => {
    for (const [ra, dec] of [[0, 0], [123.4, -45.6], [359.999, 89.9], [0, -89.9]]) {
      const { u, east, north } = equatorialTangentBasis(ra, dec);
      expect(norm(u)).toBeCloseTo(1, 12);
      expect(norm(east)).toBeCloseTo(1, 12);
      expect(norm(north)).toBeCloseTo(1, 12);
      expect(dot(u, east)).toBeCloseTo(0, 12);
      expect(dot(u, north)).toBeCloseTo(0, 12);
      expect(dot(east, north)).toBeCloseTo(0, 12);
    }
  });

  it('pins the canonical (0,0) basis and is RA-wrap invariant', () => {
    const b = equatorialTangentBasis(0, 0);
    expect(b.u).toEqual({ x: 1, y: 0, z: 0 });
    expect(b.east.x).toBeCloseTo(0, 12);
    expect(b.east.y).toBeCloseTo(1, 12);
    expect(b.north.z).toBeCloseTo(1, 12);
    const wrap = equatorialTangentBasis(360, 0);
    expect(wrap.east.y).toBeCloseTo(b.east.y, 12);
    expect(wrap.north.z).toBeCloseTo(b.north.z, 12);
  });
});

describe('velocityPcPerYr', () => {
  it('pins the km/s → pc/yr conversion', () => {
    // 1 Julian yr (3.15576e7 s) / 1 pc (3.0856775814913673e13 km).
    expect(KM_S_TO_PC_YR).toBeCloseTo(1.0227121650e-6, 15);
  });

  it('pure radial velocity lands along û with no tangential term', () => {
    const v = velocityPcPerYr(0, 0, null, null, 5, 100);
    expect(v.x).toBeCloseTo(100 * KM_S_TO_PC_YR, 18);
    expect(v.y).toBeCloseTo(0, 18);
    expect(v.z).toBeCloseTo(0, 18);
  });

  it('pure east/north PM scale with distance and never divide by cos δ', () => {
    // At (0,0): east = +y, north = +z. μ_α* is already cos δ-applied.
    const east = velocityPcPerYr(0, 0, 1000, 0, 3, 0);
    expect(east.x).toBeCloseTo(0, 18);
    expect(east.y).toBeCloseTo(3 * MAS_TO_RAD * 1000, 18);
    expect(east.z).toBeCloseTo(0, 18);
    const north = velocityPcPerYr(0, 0, 0, 1000, 3, 0);
    expect(north.z).toBeCloseTo(3 * MAS_TO_RAD * 1000, 18);
    // A high-declination star: μ_α* still maps straight onto east, so the
    // tangential speed is distance × μ, independent of dec (the cos δ is
    // already folded into μ_α*). The ecliptic-pole sign-flip bug class
    // would corrupt this.
    const hi = velocityPcPerYr(45, 80, 500, 0, 3, 0);
    const speedMasyr = norm(hi) / (3 * MAS_TO_RAD);
    expect(speedMasyr).toBeCloseTo(500, 6);
  });

  it("reproduces Barnard's Star space velocity (~142 km/s) from published μ+ϖ+RV", () => {
    // Gaia DR3: μ_α* = −798.71, μ_δ = +10337.77 mas/yr; ϖ = 546.98 mas
    // (d = 1.8282 pc); RV = −110.51 km/s. Tangential v_t = 4.74047·μ″·d.
    const d = 1000 / 546.98;
    const v = velocityPcPerYr(269.448, 4.693, -798.71, 10337.77, d, -110.51);
    const speedKmS = norm(v) / KM_S_TO_PC_YR;
    expect(speedKmS).toBeCloseTo(142.4, 0);
    // Radial component along û equals RV exactly.
    const u = equatorialTangentBasis(269.448, 4.693).u;
    const radialKmS = dot(v, u) / KM_S_TO_PC_YR;
    expect(radialKmS).toBeCloseTo(-110.51, 3);
    // Tangential matches the textbook 4.74·μ·d formula.
    const muArcsec = Math.hypot(798.71, 10337.77) / 1000;
    const tangentialKmS = Math.sqrt(speedKmS ** 2 - radialKmS ** 2);
    expect(tangentialKmS).toBeCloseTo(4.740470 * muArcsec * d, 1);
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
      hip2: new Map(), nssSourceIds: new Set(),
      tycho2: new Map(), cns5: new Map(),
    };
    const r = resolveDirection(inputs({ sourceId: '1' }), sources)!;
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
      hip2: new Map(), nssSourceIds: new Set(),
      tycho2: new Map(), cns5: new Map(),
    };
    const r = resolveDirection(inputs({ sourceId: '1' }), sources)!;
    expect(r.velVia).toBe('zero');
  });

  it('the Tycho-2 tier carries its own solution + tycho2_pm velVia', () => {
    const sources: DirectionSources = {
      gaiaAstrometry: new Map(), hip2: new Map(), nssSourceIds: new Set(),
      tycho2: new Map([[TYC, tycho2Row({ pmRaMasyr: 12, pmDecMasyr: -8 })]]),
      cns5: new Map(),
    };
    const r = resolveDirection(inputs({ tyc: TYC }), sources)!;
    expect(r.via).toBe('tycho2');
    expect(r.srcPmraMasyr).toBe(12);
    expect(r.velVia).toBe('tycho2_pm');
  });
});
