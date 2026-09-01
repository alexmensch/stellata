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
  SPINE_COLUMNS,
  serializeSpine,
  type SpineRow,
} from '../spine/inherited-spine-pure';
import { CONSTELLATIONS, createConstellationAssignment } from './constellations';
import { readStars } from './stars-parse';

const CON_ASSIGNMENT = createConstellationAssignment();
const conIndexOf = (code: string): number =>
  CONSTELLATIONS.findIndex((c) => c.code.toLowerCase() === code);

// Emitted through the shipped codec, so a column added or renamed in
// COLUMN_SPEC fails here rather than silently shifting every cell.
function writeSpineTsv(rows: readonly Partial<SpineRow>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'spine-'));
  const path = join(dir, 'inherited-spine.tsv');
  const blank = Object.fromEntries(
    SPINE_COLUMNS.map((column) => [column, '']),
  ) as SpineRow;
  writeFileSync(path, serializeSpine(rows.map((row) => ({ ...blank, ...row }))));
  return path;
}

// The spine's printed ra/dec and `mag` cells are no longer tiers of any
// cascade, so a fixture row needs a real source to be both placed and lit or
// the walk drops it. Tycho-2 serves both terms at once, and BT = VT puts the
// reduced Johnson V at exactly VT.
const ORIGIN_TYC = '1-1-1';
const RHO_AQL_TYC = '2-2-1';
// Distance now inverts a parallax too, and Tycho-2 publishes none. Gliese is
// the one parallax tier the DIRECTION cascade never reads, so seeding it places
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
      plxMas: 1000 / r.distPc, plxErrMas: 0.001,
    }])),
    rowCount: rows.length,
  };
}

function tycho2Sources(
  rows: ReadonlyArray<{ tyc: string; raDeg: number; decDeg: number; vMag: number }>,
  overrides: Partial<DirectionSources> = {},
): DirectionSources {
  return {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nssSourceIds: new Set(),
    cns5: new Map(),
    tycho2: new Map(rows.map((r) => [r.tyc, {
      raDeg: r.raDeg, decDeg: r.decDeg,
      epochRa: CATALOG_SCENE_EPOCH, epochDec: CATALOG_SCENE_EPOCH,
      pmRaMasyr: 0, pmDecMasyr: 0,
      btMag: r.vMag, vtMag: r.vMag,
      fromIcrs: false, isPhotocentre: false,
    }])),
    ...overrides,
  };
}

// ra=0 h, dec=0°, dist=100 pc → xyz=(100,0,0). V 10 at 100 pc is absmag 5.
const AT_ORIGIN_SIGHTLINE: Partial<SpineRow> = {
  ra: '0', dec: '0', dist: '100', dist_src: 'OTHER', spect: 'K0V',
  tyc: ORIGIN_TYC, gl: ORIGIN_GL,
};
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
    // The observed colour arrives through the printed I/239 tier — the spine's
    // own `ci` cell is no longer a tier, so a row with one would still take the
    // fallback and the assertion below would be vacuous.
    const { stars } = readStars(
      writeSpineTsv([
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
  // The spine froze each binding after the native → cross-walk precedence and
  // both gates ran. Re-applying the G−V gate here would re-decide it against
  // photometry the frozen build already weighed, and a scrubbed source_id
  // changes the record's designation set — so every SID keyed on it moves.
  it('takes the frozen column even where the G−V gate would scrub it', () => {
    const sourceId = '5853498713190525696';
    const gaiaAstrometry = new Map<string, GaiaAstrometryCatalogRow>([
      [sourceId, gaiaAstrometryRow({
        parallaxMas: 10, parallaxErrorMas: 0.1,
        pmraMasyr: 0, pmdecMasyr: 0, ruwe: 1, ipdFracMultiPeak: 0,
        gMag: 20.95,
      })],
    ]);
    const { stars } = readStars(
      writeSpineTsv([{
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

describe('readStars constellation assignment', () => {
  // ra=20h14m16.6s / dec=+15°11'51" — ρ Aql, whose 1992 boundary crossing by
  // proper motion is the whole reason the two constellations are separate
  // fields. See src/client/constellation-boundaries/iau-geometry/README.md
  // § ρ Aquilae.
  const RHO_AQL: Partial<SpineRow> = {
    dist: '46.5', dist_src: 'OTHER', ci: '0.08', spect: 'A2V', bayer: 'Rho',
    flam: '67', hip: '99742', hd: '192425', hr: '7724',
    ra: '20.23796', dec: '15.1975', tyc: RHO_AQL_TYC, gl: RHO_AQL_GL,
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
      writeSpineTsv([RHO_AQL]),
      { conAssignment: CON_ASSIGNMENT, directions: RHO_AQL_DIRECTIONS(), gliese: RHO_AQL_GLIESE() },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(conIndexOf('del'));
  });

  it('names no designation constellation — the spine has no editorial cell', () => {
    // ρ Aql is the sharpest case: the walk used to read "Aql" off AT-HYG's
    // `con` column, and nothing replaces it here. A GCVS designation is the
    // only source left, and this row has none, so its aliases fall back to
    // the positional index until the overlay supplies one.
    const { stars } = readStars(
      writeSpineTsv([RHO_AQL, { ...AT_ORIGIN_SIGHTLINE, proper: 'Anon' }]),
      { conAssignment: CON_ASSIGNMENT, directions: RHO_AQL_DIRECTIONS(), gliese: RHO_AQL_GLIESE() },
    );
    expect(stars.map((s) => s.desigConIndex))
      .toEqual([NO_CONSTELLATION_INDEX, NO_CONSTELLATION_INDEX]);
  });

  it('leaves Sol unclassified — the origin has no sky direction', () => {
    const { stars } = readStars(
      writeSpineTsv([{
        ra: '0', dec: '0', dist: '0', dist_src: 'OTHER', ci: '0.656',
        spect: 'G2V', proper: 'Sol',
      }]),
      { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(NO_CONSTELLATION_INDEX);
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
  // ξ UMa's Tycho-2 mean motion, on a record whose Gaia row fitted a place but
  // no motion — the shipped cohort's dominant shape.
  const TYCHO2_PM = { pmRaMasyr: -453.7, pmDecMasyr: -591.4 };
  const GAIA_EDR3 = '2020yCat.1350....0G';

  const SPINE_ROW: Partial<SpineRow> = {
    ra: '0', dec: '0', dist: '100', dist_src: 'OTHER', spect: 'K0V',
    tyc: RESCUE_TYC, proper: 'Rescued',
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
        epochRa: CATALOG_SCENE_EPOCH, epochDec: CATALOG_SCENE_EPOCH,
        pmRaMasyr: pm.pmRaMasyr, pmDecMasyr: pm.pmDecMasyr,
        btMag: 10, vtMag: 10, fromIcrs: false, isPhotocentre: false,
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
      writeSpineTsv([{ ...SPINE_ROW, gaia_source_id: SOURCE_ID }]),
      {
        conAssignment: CON_ASSIGNMENT,
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
      writeSpineTsv([{ ...SPINE_ROW, gaia_source_id: SOURCE_ID }]),
      {
        conAssignment: CON_ASSIGNMENT,
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
      writeSpineTsv([{ ...SPINE_ROW, gaia_source_id: SOURCE_ID }]),
      {
        conAssignment: CON_ASSIGNMENT,
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
      writeSpineTsv([{ ...SPINE_ROW, gaia_source_id: SOURCE_ID, gl: GJ }]),
      {
        conAssignment: CON_ASSIGNMENT,
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
      writeSpineTsv([{ ...SPINE_ROW, gl: GJ }]),
      {
        conAssignment: CON_ASSIGNMENT,
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
  const J2000_RA = 66.25076035;
  const J2000_DEC = 16.9849519;
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
        raDeg: J2000_RA, decDeg: J2000_DEC,
        cooBibcode: '2020yCat.1350....0G',
        pm: {
          pmRaMasyr: RESCUED_PMRA, pmDecMasyr: RESCUED_PMDEC,
          bibcode: '2020yCat.1350....0G',
        },
      },
    }]]),
  });

  const built = (): ReturnType<typeof readStars> => readStars(
    writeSpineTsv([{
      ra: String(J2000_RA / 15), dec: String(J2000_DEC),
      dist: String(DIST_PC), dist_src: 'OTHER', spect: 'K0V',
      tyc: NO_MEAN_TYC,
    }]),
    {
      conAssignment: CON_ASSIGNMENT,
      simbadValues: simbadPmOnly(),
      directions: {
        gaiaAstrometry: new Map(),
        hip2: new Map(),
        nssSourceIds: new Set(),
        cns5: new Map(),
        tycho2: new Map([[NO_MEAN_TYC, {
          raDeg: J2000_RA, decDeg: J2000_DEC,
          epochRa: TYCHO2_ICRS_EPOCH, epochDec: TYCHO2_ICRS_EPOCH,
          pmRaMasyr: null, pmDecMasyr: null,
          btMag: 10.0, vtMag: 10.0,
          fromIcrs: true, isPhotocentre: false,
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

  it('ships the advanced place, 1.511″ off the unpropagated J2000 cell', () => {
    // The assertion with teeth: drop the directionOnPm call in stars-parse and
    // the record lands on the raw J2000 cell, which is what the second
    // expectation measures the distance to.
    const star = built().stars[0];
    const shipped = {
      x: star.x / DIST_PC, y: star.y / DIST_PC, z: star.z / DIST_PC,
    };
    const advanced = directionAtEpoch(
      J2000_RA, J2000_DEC, RESCUED_PMRA, RESCUED_PMDEC,
      TYCHO2_ICRS_EPOCH, CATALOG_SCENE_EPOCH,
    );
    expect(angSepArcsec(shipped, advanced)).toBeCloseTo(0, 6);
    expect(angSepArcsec(shipped, unitVectorFromRaDec(J2000_RA, J2000_DEC)))
      .toBeCloseTo(1.5106, 3);
  });

  it('carries the same motion into the velocity it carried into the position', () => {
    // One motion, both terms: the tangential velocity direction must agree with
    // the direction the position moved in.
    const star = built().stars[0];
    const speed = Math.hypot(star.vx, star.vy, star.vz);
    expect(speed).toBeGreaterThan(0);
    const moved = {
      x: star.x / DIST_PC - unitVectorFromRaDec(J2000_RA, J2000_DEC).x,
      y: star.y / DIST_PC - unitVectorFromRaDec(J2000_RA, J2000_DEC).y,
      z: star.z / DIST_PC - unitVectorFromRaDec(J2000_RA, J2000_DEC).z,
    };
    const movedNorm = Math.hypot(moved.x, moved.y, moved.z);
    const cos = (moved.x * star.vx + moved.y * star.vy + moved.z * star.vz)
      / (movedNorm * speed);
    expect(cos).toBeCloseTo(1, 6);
  });
});
