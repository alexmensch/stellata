import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { SOLAR_BV_FALLBACK } from './catalog-pure';
import { avSolToStar, R_V, type DustGrid } from './dust-deextinction-pure';
import { readStars } from './stars-parse';

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
      csv, new Map(), new Map(), null,
      undefined, undefined, undefined, grid,
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
