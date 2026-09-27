import { describe, expect, it } from 'vitest';
import { R0_PC } from '../../src/client/galactic/galactic-coords';
import { bulgeDensity, discDensity } from '../../src/client/milkyway/column/milkyway-column-pure';
import {
  RESOLVED_HOLE_BANDS,
  RESOLVED_HOLE_SHELLS,
  resolvedHoleIndex,
} from '../../src/client/milkyway/calibration/resolved-fraction-pure';
import {
  MIN_STARS_PER_CELL,
  type Rotation3,
  type StarColumns,
  bandEmissivity,
  buildHoleCells,
  capSolidAngleSr,
  capSurfaceBrightness,
  fibonacciSphere,
  holeLight,
  resolvedHoleTableFromCells,
  resolvedShare,
  shellHoleLight,
  shellTotals,
  starLuminosity,
} from './resolved-light-pure';

const IDENTITY: Rotation3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const COARSE = { directions: 400, radialSteps: 2 };

function stars(rows: [number, number, number, number][]): StarColumns {
  return {
    x: Float32Array.from(rows.map((r) => r[0])),
    y: Float32Array.from(rows.map((r) => r[1])),
    z: Float32Array.from(rows.map((r) => r[2])),
    absmag: Float32Array.from(rows.map((r) => r[3])),
    count: rows.length,
  };
}

describe('cap surface brightness', () => {
  it('is 2π(1 − cos r) steradians for a cap', () => {
    expect(capSolidAngleSr(10)).toBeCloseTo(9.5456e-2, 6);
    expect(capSolidAngleSr(90)).toBeCloseTo(2 * Math.PI, 12);
  });

  // M_V = 0 at 100 pc is V = 5 over 4.061e9 arcsec²; the 11° star and Sol
  // (zero distance) contribute nothing.
  it('sums 10^(−0.4·V) inside the cap and nothing outside it', () => {
    const off = (11 * Math.PI) / 180;
    const row = capSurfaceBrightness(
      stars([
        [100, 0, 0, 0],
        [100 * Math.cos(off), 100 * Math.sin(off), 0, -5],
        [0, 0, 0, 4.83],
      ]),
      [1, 0, 0],
    );
    expect(row.stars).toBe(1);
    expect(row.magArcsec2).toBeCloseTo(29.022, 3);
  });

  it('is de-extincted: the same star twice as far reads 1.505 mag fainter', () => {
    const near = capSurfaceBrightness(stars([[100, 0, 0, 0]]), [1, 0, 0]);
    const far = capSurfaceBrightness(stars([[200, 0, 0, 0]]), [1, 0, 0]);
    expect(far.magArcsec2 - near.magArcsec2).toBeCloseTo(5 * Math.log10(2), 6);
  });
});

describe('the model side', () => {
  it('spreads unit directions evenly over the sphere', () => {
    const dirs = fibonacciSphere(2000);
    for (const d of dirs) expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    expect(dirs.filter((d) => Math.abs(d[2]) < 0.5).length).toBe(1000);
  });

  it('measures a star in the band flux unit the solve uses', () => {
    expect(starLuminosity(0)).toBe(100);
    expect(starLuminosity(5)).toBeCloseTo(1, 12);
  });

  it('sums both components at a galactocentric point', () => {
    expect(bandEmissivity([-R0_PC, 0, 0])).toBe(discDensity(R0_PC, 0) + bulgeDensity(R0_PC, 0));
  });
});

describe('hole cells on the table’s own edges', () => {
  it('bins a star by its distance shell and |sin b| from Sol', () => {
    const cells = buildHoleCells(
      stars([
        [50, 0, 0, 0],
        [0, 0, 500, 5],
      ]),
      IDENTITY,
      COARSE,
    );
    expect(cells).toHaveLength(RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS);
    const lit = cells.filter((c) => c.stars > 0);
    expect(lit.map((c) => [c.shell, c.band, c.stars, c.catalogue])).toEqual([
      [6, 0, 1, 100],
      [16, RESOLVED_HOLE_BANDS - 1, 1, expect.closeTo(1, 12)],
    ]);
  });

  // 2 % under ρ(Sol) × volume: the vertical exponential falls faster than
  // the radial one rises across a 10–12.6 pc shell.
  it('samples the model to the emissivity at Sol in the first shell', () => {
    const [inner] = shellTotals(buildHoleCells(stars([]), IDENTITY));
    const volume = (4 / 3) * Math.PI * (inner.outerPc ** 3 - inner.innerPc ** 3);
    expect(inner.model / (bandEmissivity([-R0_PC, 0, 0]) * volume)).toBeCloseTo(0.982, 3);
  });

  // Scalars only: the roll-up used to concatenate every cell's samples —
  // 49 MB of copies — to read the two terms of one ratio.
  it('sums the bands back into all-sky shells', () => {
    const cells = buildHoleCells(stars([[50, 0, 0, 0]]), IDENTITY, COARSE);
    const shells = shellTotals(cells);
    expect(shells).toHaveLength(RESOLVED_HOLE_SHELLS);
    expect(shells[6].catalogue).toBe(100);
    expect(shells[6].model).toBeCloseTo(
      cells.filter((c) => c.shell === 6).reduce((s, c) => s + c.model, 0),
      9,
    );
    expect(cells.filter((c) => c.shell === 6)
      .reduce((n, c) => n + c.samples.light.length, 0))
      .toBe(COARSE.directions * COARSE.radialSteps);
  });

  it('removes the same light per shell whether summed by cell or by row', () => {
    const cells = buildHoleCells(stars([]), IDENTITY, COARSE);
    const table = resolvedHoleTableFromCells(cells);
    const removed = shellHoleLight(cells, table);
    expect(removed[6]).toBeCloseTo(
      cells.filter((c) => c.shell === 6).reduce((s, c) => s + holeLight(c, table), 0), 12);
  });

  it('clamps a cell the catalogue outshines to wholly resolved', () => {
    const [cell] = buildHoleCells(stars([[12, 0, 0, -10]]), IDENTITY, COARSE);
    expect(cell.catalogue).toBeGreaterThan(cell.model);
    expect(resolvedShare(cell)).toBe(1);
  });

  it('removes the whole cell at a table of ones and nothing at zeros', () => {
    const [cell] = buildHoleCells(stars([]), IDENTITY, COARSE);
    const size = RESOLVED_HOLE_SHELLS * RESOLVED_HOLE_BANDS;
    expect(holeLight(cell, { values: new Array(size).fill(1) })).toBeCloseTo(cell.model, 9);
    expect(holeLight(cell, { values: new Array(size).fill(0) })).toBe(0);
  });
});

describe('the table from the cells', () => {
  const cells = buildHoleCells(stars([]), IDENTITY, COARSE);

  it('gives a well-populated cell its own share', () => {
    const own = cells.map((c) =>
      c.shell === 10 && c.band === 2
        ? { ...c, stars: MIN_STARS_PER_CELL, catalogue: 0.25 * c.model }
        : c,
    );
    const table = resolvedHoleTableFromCells(own);
    expect(table.values[resolvedHoleIndex(10, 2)]).toBeCloseTo(0.25, 12);
    expect(table.values[resolvedHoleIndex(10, 3)]).toBeCloseTo(
      resolvedShare(shellTotals(own)[10]),
      12,
    );
  });

  it('gives a thin cell its shell’s all-sky share instead', () => {
    const thin = cells.map((c) =>
      c.shell === 10 && c.band === 2
        ? { ...c, stars: MIN_STARS_PER_CELL - 1, catalogue: 0.25 * c.model }
        : c,
    );
    const table = resolvedHoleTableFromCells(thin);
    const shellShare = resolvedShare(shellTotals(thin)[10]);
    expect(shellShare).toBeGreaterThan(0);
    expect(shellShare).toBeLessThan(0.25);
    expect(table.values[resolvedHoleIndex(10, 2)]).toBeCloseTo(shellShare, 12);
  });
});
