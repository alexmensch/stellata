import { describe, it, expect } from 'vitest';

import {
  ELEMENT_COLUMNS,
  type PlanetElementTableFile,
} from '../../../../scripts/ephemerides/planet-element-schema';
import { buildElementTable, elementTableSampleAt } from './element-table';
import { makeEquinoctial } from './equinoctial-pure';

/** λ advances by a whole 205° per step — the column that exposed the clamped
 *  end tangent — while the rest drift slowly. */
function linearFile(count: number, stepDays = 50): PlanetElementTableFile {
  return {
    id: 'test',
    horizonsId: '6',
    jd0: 2415020,
    stepDays,
    source: {
      frame: 'Ecliptic of J2000.0', center: 'Sun (10)', units: 'AU-D',
      outputType: 'GEOMETRIC osculating elements', targetBody: 'test', retrievedUtc: '',
    },
    positionToleranceAu: 1e-5,
    columns: ELEMENT_COLUMNS,
    samples: Array.from({ length: count }, (_, i) => [
      9.5 + i * 1e-6, 0.01 + i * 1e-7, 0.05 - i * 1e-7, 0.02, -0.008, 205 * i,
    ]),
  };
}

describe('buildElementTable', () => {
  it('derives the last epoch from jd0 + (count − 1)·step', () => {
    const table = buildElementTable(linearFile(5));
    expect(table.count).toBe(5);
    expect(table.jdLast).toBe(2415020 + 4 * 50);
  });

  it('rejects a file too short to interpolate, a bad step, and a short row', () => {
    expect(() => buildElementTable(linearFile(1))).toThrow(/1 samples/);
    expect(() => buildElementTable({ ...linearFile(4), stepDays: 0 })).toThrow(/step 0/);
    const short = linearFile(4);
    short.samples[2] = [1, 2, 3];
    expect(() => buildElementTable(short)).toThrow(/3 columns/);
  });

  it('rejects a non-finite cell rather than shipping NaN into the Kepler solve', () => {
    const bad = linearFile(4);
    bad.samples[1][5] = Number.NaN;
    expect(() => buildElementTable(bad)).toThrow(/not finite/);
  });
});

describe('elementTableSampleAt', () => {
  const table = buildElementTable(linearFile(10));
  const out = makeEquinoctial();

  it('reports out-of-span epochs without touching out', () => {
    out.lambdaDeg = -1;
    expect(elementTableSampleAt(table, table.jd0 - 1e-9, out)).toBe(false);
    expect(elementTableSampleAt(table, table.jdLast + 1e-9, out)).toBe(false);
    expect(out.lambdaDeg).toBe(-1);
  });

  it('reproduces the stored sample exactly on a grid epoch', () => {
    expect(elementTableSampleAt(table, table.jd0 + 3 * 50, out)).toBe(true);
    expect(out.aAu).toBeCloseTo(9.5 + 3e-6, 14);
    expect(out.lambdaDeg).toBeCloseTo(615, 12);
  });

  it('covers the final epoch, where the bracketing interval has to clamp', () => {
    expect(elementTableSampleAt(table, table.jdLast, out)).toBe(true);
    expect(out.lambdaDeg).toBeCloseTo(205 * 9, 10);
  });

  it('reproduces linear data exactly at interval midpoints', () => {
    // Catmull–Rom is exact for a linear series, in the interior AND in the two
    // boundary intervals — which is the point of extrapolating the missing
    // control point rather than clamping it. Clamping halves the end tangent
    // and lands λ at 51.25 instead of 102.5.
    for (const i of [0, 4, 8]) {
      expect(elementTableSampleAt(table, table.jd0 + (i + 0.5) * 50, out)).toBe(true);
      expect(out.lambdaDeg).toBeCloseTo(205 * (i + 0.5), 9);
      expect(out.aAu).toBeCloseTo(9.5 + (i + 0.5) * 1e-6, 14);
    }
  });
});
