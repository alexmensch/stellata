import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { NO_CONSTELLATION_INDEX, SOLAR_BV_FALLBACK } from '../catalog-pure';
import { avSolToStar, R_V, type DustGrid } from '../distance/dust-deextinction-pure';
import {
  CATALOG_SCENE_EPOCH,
  directionAtEpoch,
  type DirectionSources,
  type GaiaAstrometryCatalogRow,
} from '../distance/direction-cascade';
import { gaiaAstrometryRow } from '../distance/astrometry-fixture';
import { cns5Astrometry } from '../classic-ids/cns5-fixture';
import { TYCHO2_ICRS_EPOCH } from '../tycho2-parse';
import { emptySimbadValueIndex, type SimbadValueIndex } from '../simbad-values-parse';
import { unitVectorFromRaDec, type UnitVector } from '../../../src/client/util/equatorial-basis';
import type { GlieseIndex } from '../gliese-parse';
import {
  MANIFEST_COLUMNS,
  serializeManifest,
  type ManifestRow,
} from '../membership/membership-manifest-pure';
import { CONSTELLATIONS, createConstellationAssignment } from './constellations';
import { readStars } from './stars-parse';

const CON_ASSIGNMENT = createConstellationAssignment();
const conIndexOf = (code: string): number =>
  CONSTELLATIONS.findIndex((c) => c.code.toLowerCase() === code);

// Emitted through the shipped codec, so a column added or renamed in
// MANIFEST_COLUMNS fails here rather than silently shifting every cell.
function writeManifestTsv(rows: readonly Partial<ManifestRow>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
  const path = join(dir, 'membership-manifest.tsv');
  const blank = Object.fromEntries(
    MANIFEST_COLUMNS.map((column) => [column, '']),
  ) as ManifestRow;
  writeFileSync(path, serializeManifest(rows.map((row) => ({ ...blank, ...row }))));
  return path;
}

// The manifest carries designations alone, so a fixture row needs a real
// source to be both placed and lit or the walk parks it. Tycho-2 serves both
// terms at once, and BT = VT puts the reduced Johnson V at exactly VT.
const ORIGIN_TYC = '1-1-1';
const RHO_AQL_TYC = '2-2-1';
// Distance inverts a parallax too, and Tycho-2 publishes none. Gliese is the
// one parallax tier the DIRECTION cascade never reads, so seeding it places
// the fixture rows without moving which tier resolves their position.
const ORIGIN_GL = '901';
const RHO_AQL_GL = '902';

function glieseParallaxes(
  rows: ReadonlyArray<{ gl: string; distPc: number }>,
): GlieseIndex {
  return {
    byKey: new Map(rows.map((r) => [r.gl, {
      name: `Gl ${r.gl}`, comp: '',
      vMag: null, bMinusV: null, spectral: null,
      parallax: { mas: 1000 / r.distPc, errMas: 0.001, trigonometric: true },
    }])),
    rowCount: rows.length,
  };
}

function tycho2Sources(
  rows: ReadonlyArray<{ tyc: string; raDeg: number; decDeg: number; vMag: number | null }>,
  overrides: Partial<DirectionSources> = {},
): DirectionSources {
  return {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nssSourceIds: new Set(),
    cns5: new Map(),
    tycho2: new Map(rows.map((r) => [r.tyc, {
      raDeg: r.raDeg, decDeg: r.decDeg,
      epoch: CATALOG_SCENE_EPOCH,
      pmRaMasyr: 0, pmDecMasyr: 0,
      btMag: r.vMag, vtMag: r.vMag,
      fromIcrs: false, isPhotocentre: false, hip: null,
    }])),
    ...overrides,
  };
}

// Placed at ra=0°, dec=0°, 100 pc → xyz=(100,0,0). V 10 at 100 pc is absmag 5.
const AT_ORIGIN_SIGHTLINE: Partial<ManifestRow> = { tyc: ORIGIN_TYC, gl: ORIGIN_GL };
const AT_ORIGIN_DIRECTIONS = (): DirectionSources =>
  tycho2Sources([{ tyc: ORIGIN_TYC, raDeg: 0, decDeg: 0, vMag: 10.0 }]);

// Constant density everywhere (logRatio 0 collapses the exponential
// decode), so any sightline inside the cube accumulates non-zero A_V.
function uniformDustGrid(): DustGrid {
  return {
    gridSize: 2,
    boundsHalfPc: 200,
    densityMin: 0.01,
    logRatio: 0,
    avPerDensityPc: 2.742,
    voxelSizePc: 200,
    data: new Uint8Array(8).fill(255),
  };
}

describe('readStars build-time de-extinction of ci', () => {
  it('de-reddens an observed ci but never the solar fallback', () => {
    const grid = uniformDustGrid();
    // The observed colour arrives through the printed I/239 tier — the one
    // measured colour a row with no Gaia source can reach.
    const { stars } = readStars(
      writeManifestTsv([
        { ...AT_ORIGIN_SIGHTLINE, proper: 'BlankCi' },
        { ...AT_ORIGIN_SIGHTLINE, proper: 'ObservedCi', hip: '11111' },
      ]),
      {
        conAssignment: CON_ASSIGNMENT,
        dustGrid: grid,
        hipBv: new Map([[11111, 0.5]]),
        directions: AT_ORIGIN_DIRECTIONS(),
        gliese: glieseParallaxes([{ gl: ORIGIN_GL, distPc: 100 }]),
      },
    );
    expect(stars).toHaveLength(2);
    const av = avSolToStar(grid, 100, 0, 0);
    expect(av).toBeGreaterThan(1); // the gate must have something to bite on

    const blank = stars.find((s) => s.proper === 'BlankCi')!;
    const observed = stars.find((s) => s.proper === 'ObservedCi')!;
    // The fallback ci is already intrinsic — de-reddening it fabricates
    // a hot-blue colour on dusty sightlines.
    expect(blank.ci).toBe(SOLAR_BV_FALLBACK);
    expect(observed.ci).toBeCloseTo(0.5 - av / R_V, 12);
    // absmag is observed-convention on both rows and always de-extincts.
    expect(blank.absmag).toBeCloseTo(5.0 - av, 12);
    expect(observed.absmag).toBeCloseTo(5.0 - av, 12);
  });
});

describe('readStars Gaia source_id', () => {
  // The manifest justified each binding (docs/catalog-driver.md § 3.1).
  // Re-applying the G−V gate here would re-decide it against photometry the
  // manifest build already weighed, and a scrubbed source_id changes the
  // record's designation set — so every SID keyed on it moves.
  it('takes the manifest column even where the G−V gate would scrub it', () => {
    const sourceId = '5853498713190525696';
    const gaiaAstrometry = new Map<string, GaiaAstrometryCatalogRow>([
      [sourceId, gaiaAstrometryRow({
        parallaxMas: 10, parallaxErrorMas: 0.1,
        pmraMasyr: 0, pmdecMasyr: 0, ruwe: 1, ipdFracMultiPeak: 0,
        gMag: 20.95,
      })],
    ]);
    const { stars } = readStars(
      writeManifestTsv([{
        ...AT_ORIGIN_SIGHTLINE, gaia_source_id: sourceId,
      }]),
      {
        conAssignment: CON_ASSIGNMENT,
        // Gaia places it (outranking Tycho-2); Tycho-2 still has to light it,
        // since this Gaia row carries no BP/RP for the Riello transform.
        directions: tycho2Sources(
          [{ tyc: ORIGIN_TYC, raDeg: 0, decDeg: 0, vMag: 1.33 }],
          { gaiaAstrometry },
        ),
      },
    );
    expect(stars[0].gaiaSourceId).toBe(sourceId);
  });
});

describe('readStars manifest labels', () => {
  it('carries the alias lists and the cascade diagnostics onto the record', () => {
    const { stars } = readStars(
      writeManifestTsv([{
        ...AT_ORIGIN_SIGHTLINE, hd: '100', hd_alt: '101|102', hr: '7', hr_alt: '8',
      }]),
      {
        conAssignment: CON_ASSIGNMENT,
        directions: AT_ORIGIN_DIRECTIONS(),
        gliese: glieseParallaxes([{ gl: ORIGIN_GL, distPc: 100 }]),
      },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0]).toMatchObject({
      hd: 100, hdAlt: [101, 102], hr: 7, hrAlt: [8],
      plxVia: 'gliese_plx', distVia: 'gliese_plx',
    });
    expect(stars[0].plxDistPc).toBeCloseTo(100, 9);
  });

  it('parks a row no V tier lights, under its own § 6.1 reason', () => {
    const { stars, stats } = readStars(
      writeManifestTsv([{ ...AT_ORIGIN_SIGHTLINE, hd: '55' }]),
      {
        conAssignment: CON_ASSIGNMENT,
        directions: tycho2Sources([{ tyc: ORIGIN_TYC, raDeg: 0, decDeg: 0, vMag: null }]),
        gliese: glieseParallaxes([{ gl: ORIGIN_GL, distPc: 100 }]),
      },
    );
    expect(stars).toHaveLength(0);
    expect(stats.parked).toEqual([{
      tyc: ORIGIN_TYC, hip: null, hd: 55, gl: ORIGIN_GL, gaiaSourceId: null,
      reason: 'no_v_magnitude',
    }]);
    expect(stats.vVia.none).toBe(1);
    expect(stats.distVia.gliese_plx).toBe(0);
  });
});

describe('readStars constellation assignment', () => {
  // ra=20h14m16.6s / dec=+15°11'51" — ρ Aql, whose 1992 boundary crossing by
  // proper motion is the whole reason the two constellations are separate
  // fields. See src/client/constellation-boundaries/iau-geometry/README.md
  // § ρ Aquilae.
  const RHO_AQL: Partial<ManifestRow> = {
    bayer: 'Rho', flam: '67', hip: '99742', hd: '192425', hr: '7724',
    tyc: RHO_AQL_TYC, gl: RHO_AQL_GL,
  };
  // 20.23796 h × 15 = 303.5694°.
  const RHO_AQL_DIRECTIONS = (): DirectionSources => tycho2Sources([
    { tyc: RHO_AQL_TYC, raDeg: 303.5694, decDeg: 15.1975, vMag: 4.94 },
    { tyc: ORIGIN_TYC, raDeg: 0, decDeg: 0, vMag: 10.0 },
  ]);
  const RHO_AQL_GLIESE = (): GlieseIndex => glieseParallaxes([
    { gl: RHO_AQL_GL, distPc: 46.5 },
    { gl: ORIGIN_GL, distPc: 100 },
  ]);

  it('resolves byte 34 positionally', () => {
    const { stars } = readStars(
      writeManifestTsv([RHO_AQL]),
      { conAssignment: CON_ASSIGNMENT, directions: RHO_AQL_DIRECTIONS(), gliese: RHO_AQL_GLIESE() },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(conIndexOf('del'));
  });

  it('names no designation constellation — the manifest has no editorial cell', () => {
    // ρ Aql is the sharpest case: the walk used to read "Aql" off AT-HYG's
    // `con` column, and nothing replaces it here. The IV/27A, WGSN and GCVS
    // passes downstream are the only sources, and this row reaches none of
    // them in a bare walk, so its aliases fall back to the positional index.
    const { stars } = readStars(
      writeManifestTsv([RHO_AQL, { ...AT_ORIGIN_SIGHTLINE, proper: 'Anon' }]),
      { conAssignment: CON_ASSIGNMENT, directions: RHO_AQL_DIRECTIONS(), gliese: RHO_AQL_GLIESE() },
    );
    expect(stars.map((s) => s.desigConIndex))
      .toEqual([NO_CONSTELLATION_INDEX, NO_CONSTELLATION_INDEX]);
  });

  it('leaves Sol unclassified — the origin has no sky direction', () => {
    const { stars } = readStars(
      writeManifestTsv([{ proper: 'Sol' }]),
      { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(NO_CONSTELLATION_INDEX);
    expect(stars[0]).toMatchObject({ plxDistPc: null, plxVia: 'curated', distVia: 'curated' });
  });
});

// resolvePmRescue is pinned in isolation by ../distance/pm-rescue/. What these
// pin is the wiring readStars owns and no unit test reaches: which rows enter
// the cascade at all, the 2p condition it hands them, and the velocityVia the
// route is re-credited to.
describe('readStars PM rescue', () => {
  const RESCUE_TYC = '3-3-1';
  const SOURCE_ID = '756853643638639104';
  const GJ = 'Gl 423A';
  // The rescue cohort is 2p rows, which is exactly the cohort the parallax
  // cascade parks: Gaia fitted no parallax and Tycho-2 publishes none, so
  // without an owned one these rows build no record at all and there is no
  // motion left to assert on. Gliese supplies it — the one parallax tier the
  // DIRECTION cascade never reads, so which tier resolves the position and
  // which the motion are both untouched.
  const RESCUE_GL = '903';
  const PARALLAXES = glieseParallaxes([
    { gl: RESCUE_GL, distPc: 100 }, { gl: '423A', distPc: 100 },
  ]);
  // ξ UMa's Tycho-2 mean motion, on a record whose Gaia row fitted a place but
  // no motion — the shipped cohort's dominant shape.
  const TYCHO2_PM = { pmRaMasyr: -453.7, pmDecMasyr: -591.4 };
  const GAIA_EDR3 = '2020yCat.1350....0G';

  const MANIFEST_ROW: Partial<ManifestRow> = {
    tyc: RESCUE_TYC, gl: RESCUE_GL, proper: 'Rescued',
  };

  // Tycho-2 serves V here as it does for the AT_ORIGIN rows above; `pm` is
  // what each case varies. A null PM is the pflag='X' shape — a position with
  // no mean solution behind it.
  function sources(
    pm: { pmRaMasyr: number | null; pmDecMasyr: number | null },
    overrides: Partial<DirectionSources> = {},
  ): DirectionSources {
    return {
      gaiaAstrometry: new Map(),
      hip2: new Map(),
      nssSourceIds: new Set(),
      cns5: new Map(),
      tycho2: new Map([[RESCUE_TYC, {
        raDeg: 0, decDeg: 0,
        epoch: CATALOG_SCENE_EPOCH,
        pmRaMasyr: pm.pmRaMasyr, pmDecMasyr: pm.pmDecMasyr,
        btMag: 10, vtMag: 10, fromIcrs: false, isPhotocentre: false, hip: null,
      }]]),
      ...overrides,
    };
  }

  const gaiaRow = (overrides: Partial<GaiaAstrometryCatalogRow> = {}) =>
    new Map([[SOURCE_ID, gaiaAstrometryRow(overrides)]]);

  const speed = (s: { vx: number; vy: number; vz: number }): number =>
    Math.hypot(s.vx, s.vy, s.vz);

  it('rescues a 2p row off its own TYC, and credits Tycho-2 not the tier', () => {
    const { stars, stats } = readStars(
      writeManifestTsv([{ ...MANIFEST_ROW, gaia_source_id: SOURCE_ID }]),
      {
        conAssignment: CON_ASSIGNMENT,
        gliese: PARALLAXES,
        directions: sources(TYCHO2_PM, { gaiaAstrometry: gaiaRow() }),
      },
    );
    // The position still comes from the Gaia anchor — only the motion is
    // re-keyed.
    expect(stats.directionVia.gaia_5p).toBe(1);
    expect(stats.pmRescueVia.tycho2).toBe(1);
    expect(stats.velocityVia.tycho2_pm).toBe(1);
    expect(stats.velocityVia.zero).toBe(0);
    expect(speed(stars[0])).toBeGreaterThan(0);
  });

  it('ships static where the cascade reaches nothing — the control', () => {
    const { stars, stats } = readStars(
      writeManifestTsv([{ ...MANIFEST_ROW, gaia_source_id: SOURCE_ID }]),
      {
        conAssignment: CON_ASSIGNMENT,
        gliese: PARALLAXES,
        directions: sources(
          { pmRaMasyr: null, pmDecMasyr: null },
          { gaiaAstrometry: gaiaRow() },
        ),
      },
    );
    expect(stats.pmRescueVia.none).toBe(1);
    expect(stats.velocityVia.zero).toBe(1);
    expect(speed(stars[0])).toBe(0);
  });

  it('never enters the cascade where the tier states its own motion', () => {
    const { stats } = readStars(
      writeManifestTsv([{ ...MANIFEST_ROW, gaia_source_id: SOURCE_ID }]),
      {
        conAssignment: CON_ASSIGNMENT,
        gliese: PARALLAXES,
        directions: sources(TYCHO2_PM, {
          gaiaAstrometry: gaiaRow({
            parallaxMas: 50, pmraMasyr: 100, pmdecMasyr: -100,
          }),
        }),
      },
    );
    expect(stats.velocityVia.gaia_pm).toBe(1);
    // Every rescue bucket empty: a 5p row must not reach the cascade at all,
    // or Tycho-2's blend motion would displace Gaia's own converged fit.
    expect(Object.values(stats.pmRescueVia).every((n) => n === 0)).toBe(true);
  });

  it("refuses a Gaia-bibcoded motion on the record's OWN 2p solution", () => {
    const { stars, stats } = readStars(
      writeManifestTsv([{ ...MANIFEST_ROW, gaia_source_id: SOURCE_ID, gl: GJ }]),
      {
        conAssignment: CON_ASSIGNMENT,
        gliese: PARALLAXES,
        directions: sources({ pmRaMasyr: null, pmDecMasyr: null }, {
          gaiaAstrometry: gaiaRow(),
          cns5: new Map([['423A', cns5Astrometry({
            pm: { pmRaMasyr: 50, pmDecMasyr: -20, bibcode: GAIA_EDR3 },
          })]]),
        }),
      },
    );
    expect(stats.pmRescueVia.gaia_bibcode_skipped).toBe(1);
    expect(speed(stars[0])).toBe(0);
  });

  it('takes that same motion where no Gaia fit stands behind the record', () => {
    // Identical to the case above but for the absent Gaia row, which is the
    // whole of the difference: with no fit to distrust the citation is
    // ordinary. Inverting the predicate would strip the motion from these.
    const { stars, stats } = readStars(
      writeManifestTsv([{ ...MANIFEST_ROW, gl: GJ }]),
      {
        conAssignment: CON_ASSIGNMENT,
        gliese: PARALLAXES,
        directions: sources({ pmRaMasyr: null, pmDecMasyr: null }, {
          cns5: new Map([['423A', cns5Astrometry({
            pm: { pmRaMasyr: 50, pmDecMasyr: -20, bibcode: GAIA_EDR3 },
          })]]),
        }),
      },
    );
    expect(stats.directionVia.tycho2).toBe(1);
    expect(stats.pmRescueVia.cns5).toBe(1);
    expect(stats.velocityVia.cns5_pm).toBe(1);
    expect(speed(stars[0])).toBeGreaterThan(0);
  });
});

describe('readStars advances the position on a rescued PM', () => {
  // TYC 1269-128-1 (HD 285742), the largest of the three movers, on its real
  // numbers: Tycho-2 supplement 1 states a J2000 cell and no PM, so the
  // direction tier wins on rank while the motion comes from SIMBAD. The unit
  // pins live in ../distance/direction-cascade.test.ts; this one is the wiring,
  // which is the half that ships the position.
  const NO_MEAN_TYC = '1269-128-1';
  // Same reason as the rescue suite above: a 2p row with no owned parallax
  // parks, so Gliese states the distance the position assertions measure at.
  const NO_MEAN_GL = '904';
  const OBSERVED_RA = 66.25076035;
  const OBSERVED_DEC = 16.9849519;
  const RESCUED_PMRA = 91.121;
  const RESCUED_PMDEC = -24.707;
  const DIST_PC = 52.6;

  const angSepArcsec = (a: UnitVector, b: UnitVector): number =>
    Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)))
    * ((180 * 3600) / Math.PI);

  const simbadPmOnly = (): SimbadValueIndex => ({
    ...emptySimbadValueIndex(),
    rowCount: 1,
    byTyc: new Map([[NO_MEAN_TYC, {
      rv: null,
      parallax: null,
      astrometry: {
        raDeg: OBSERVED_RA, decDeg: OBSERVED_DEC,
        cooBibcode: '2020yCat.1350....0G',
        pm: {
          pmRaMasyr: RESCUED_PMRA, pmDecMasyr: RESCUED_PMDEC,
          bibcode: '2020yCat.1350....0G',
        },
      },
    }]]),
  });

  const built = (): ReturnType<typeof readStars> => readStars(
    writeManifestTsv([{ tyc: NO_MEAN_TYC, gl: NO_MEAN_GL }]),
    {
      conAssignment: CON_ASSIGNMENT,
      simbadValues: simbadPmOnly(),
      gliese: glieseParallaxes([{ gl: NO_MEAN_GL, distPc: DIST_PC }]),
      directions: {
        gaiaAstrometry: new Map(),
        hip2: new Map(),
        nssSourceIds: new Set(),
        cns5: new Map(),
        tycho2: new Map([[NO_MEAN_TYC, {
          raDeg: OBSERVED_RA, decDeg: OBSERVED_DEC,
          epoch: TYCHO2_ICRS_EPOCH,
          pmRaMasyr: null, pmDecMasyr: null,
          btMag: 10.0, vtMag: 10.0,
          fromIcrs: true, isPhotocentre: false, hip: null,
        }]]),
      },
    },
  );

  it('routes the row through the rescue and credits SIMBAD for the motion', () => {
    const { stars, stats } = built();
    expect(stars).toHaveLength(1);
    expect(stats.directionVia.tycho2).toBe(1);
    expect(stats.pmRescueVia.simbad).toBe(1);
    expect(stats.velocityVia.simbad_pm).toBe(1);
  });

  it('ships the advanced place, 2.337″ off the unpropagated observed cell', () => {
    // The assertion with teeth: drop the directionOnPm call in stars-parse and
    // the record lands on the raw observed cell, which is what the second
    // expectation measures the distance to. 24.75 yr of this star's motion,
    // since a row with no mean solution states its position at J1991.25.
    const star = built().stars[0];
    const shipped = {
      x: star.x / DIST_PC, y: star.y / DIST_PC, z: star.z / DIST_PC,
    };
    const advanced = directionAtEpoch(
      OBSERVED_RA, OBSERVED_DEC, RESCUED_PMRA, RESCUED_PMDEC,
      TYCHO2_ICRS_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angSepArcsec(shipped, advanced)).toBeCloseTo(0, 6);
    expect(angSepArcsec(shipped, unitVectorFromRaDec(OBSERVED_RA, OBSERVED_DEC)))
      .toBeCloseTo(2.3367, 3);
  });

  it('carries the same motion into the velocity it carried into the position', () => {
    // One motion, both terms: the tangential velocity direction must agree with
    // the direction the position moved in.
    const star = built().stars[0];
    const speed = Math.hypot(star.vx, star.vy, star.vz);
    expect(speed).toBeGreaterThan(0);
    const moved = {
      x: star.x / DIST_PC - unitVectorFromRaDec(OBSERVED_RA, OBSERVED_DEC).x,
      y: star.y / DIST_PC - unitVectorFromRaDec(OBSERVED_RA, OBSERVED_DEC).y,
      z: star.z / DIST_PC - unitVectorFromRaDec(OBSERVED_RA, OBSERVED_DEC).z,
    };
    const movedNorm = Math.hypot(moved.x, moved.y, moved.z);
    const cos = (moved.x * star.vx + moved.y * star.vy + moved.z * star.vz)
      / (movedNorm * speed);
    expect(cos).toBeCloseTo(1, 6);
  });
});
