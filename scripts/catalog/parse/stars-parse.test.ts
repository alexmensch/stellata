import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { NO_CONSTELLATION_INDEX, SOLAR_BV_FALLBACK } from '../catalog-pure';
import { avSolToStar, R_V, type DustGrid } from '../distance/dust-deextinction-pure';
import type { GaiaAstrometryCatalogRow } from '../distance/direction-cascade';
import { gaiaAstrometryRow } from '../distance/astrometry-fixture';
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

// ra=0 h, dec=0°, dist=100 pc → xyz=(100,0,0). mag 10 at 100 pc is absmag 5.
const AT_ORIGIN_SIGHTLINE: Partial<SpineRow> = {
  ra: '0', dec: '0', dist: '100', dist_src: 'OTHER', spect: 'K0V', mag: '10.0',
};

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
    const { stars } = readStars(
      writeSpineTsv([
        { ...AT_ORIGIN_SIGHTLINE, proper: 'BlankCi' },
        { ...AT_ORIGIN_SIGHTLINE, proper: 'ObservedCi', ci: '0.5' },
      ]),
      { conAssignment: CON_ASSIGNMENT, dustGrid: grid },
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
        ...AT_ORIGIN_SIGHTLINE, mag: '1.33', gaia_source_id: sourceId,
      }]),
      {
        conAssignment: CON_ASSIGNMENT,
        directions: { gaiaAstrometry, hip2: new Map(), nssSourceIds: new Set() },
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
    ra: '20.23796', dec: '15.1975', mag: '4.94',
  };

  it('resolves byte 34 positionally', () => {
    const { stars } = readStars(
      writeSpineTsv([RHO_AQL]), { conAssignment: CON_ASSIGNMENT },
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
      { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars.map((s) => s.desigConIndex))
      .toEqual([NO_CONSTELLATION_INDEX, NO_CONSTELLATION_INDEX]);
  });

  it('leaves Sol unclassified — the origin has no sky direction', () => {
    const { stars } = readStars(
      writeSpineTsv([{
        ra: '0', dec: '0', dist: '0', dist_src: 'OTHER', ci: '0.656',
        spect: 'G2V', proper: 'Sol', mag: '-26.7',
      }]),
      { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(NO_CONSTELLATION_INDEX);
  });
});
