import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { NO_CONSTELLATION_INDEX, SOLAR_BV_FALLBACK } from '../catalog-pure';
import { avSolToStar, R_V, type DustGrid } from '../distance/dust-deextinction-pure';
import { CONSTELLATIONS, createConstellationAssignment } from './constellations';
import { readStars } from './stars-parse';

const CON_ASSIGNMENT = createConstellationAssignment();
const conIndexOf = (code: string): number =>
  CONSTELLATIONS.findIndex((c) => c.code.toLowerCase() === code);

const ATHYG_HEADER =
  'absmag,dist,dist_src,ci,spect,con,proper,bayer,flam,hip,hd,hr,gl,ra,dec,mag,gaia,pm_ra,pm_dec';

function writeAthygCsv(rows: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'athyg-'));
  const path = join(dir, 'athyg.csv');
  writeFileSync(path, [ATHYG_HEADER, ...rows].join('\n') + '\n');
  return path;
}

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
  it('de-reddens an observed ci but never the solar fallback', async () => {
    const grid = uniformDustGrid();
    const csv = writeAthygCsv([
      // ra=0 h, dec=0°, dist=100 pc → xyz=(100,0,0), inside the cube.
      '5.0,100,OTHER,,K0V,,BlankCi,,,,,,,0,0,10.0,,,',
      '5.0,100,OTHER,0.5,K0V,,ObservedCi,,,,,,,0,0,10.0,,,',
    ]);
    const { stars } = await readStars(
      csv, { conAssignment: CON_ASSIGNMENT, dustGrid: grid },
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

describe('readStars constellation assignment', () => {
  // ra=20h14m16.6s / dec=+15°11'51" — ρ Aql, whose 1992 boundary crossing by
  // proper motion is the whole reason the two constellations are separate
  // fields. See src/client/constellation-boundaries/iau-geometry/README.md
  // § ρ Aquilae.
  const RHO_AQL_ROW = '2.17,46.5,OTHER,0.08,A2V,Aql,,Rho,67,99742,192425,7724,,20.23796,15.1975,4.94,,,';

  it('resolves byte 34 positionally while the designation keeps AT-HYG con', async () => {
    const { stars, stats } = await readStars(
      writeAthygCsv([RHO_AQL_ROW]), { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(conIndexOf('del'));
    expect(stars[0].desigConIndex).toBe(conIndexOf('aql'));
    expect(stats.conPositionalDisagreement).toBe(1);
  });

  it('assigns a row AT-HYG left unclassified and counts no disagreement', async () => {
    // ra=0 h / dec=0° is in Pisces. An empty editorial cell is not a
    // disagreement — there is nothing to disagree with.
    const { stars, stats } = await readStars(
      writeAthygCsv(['5.0,100,OTHER,0.5,K0V,,Anon,,,,,,,0,0,10.0,,,']),
      { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars[0].conIndex).toBe(conIndexOf('psc'));
    expect(stars[0].desigConIndex).toBe(NO_CONSTELLATION_INDEX);
    expect(stats.conPositionalDisagreement).toBe(0);
  });

  it('leaves Sol unclassified — the origin has no sky direction', async () => {
    const { stars } = await readStars(
      writeAthygCsv(['4.85,0,OTHER,0.656,G2V,,Sol,,,,,,,0,0,-26.7,,,']),
      { conAssignment: CON_ASSIGNMENT },
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].conIndex).toBe(NO_CONSTELLATION_INDEX);
  });

  it('rejects an AT-HYG con cell absent from the IAU-88 table', async () => {
    await expect(readStars(
      writeAthygCsv(['5.0,100,OTHER,0.5,K0V,Zzz,Anon,,,,,,,0,0,10.0,,,']),
      { conAssignment: CON_ASSIGNMENT },
    )).rejects.toThrow(/not in the IAU-88 table/);
  });
});
