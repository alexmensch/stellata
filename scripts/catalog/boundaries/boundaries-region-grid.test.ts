import { describe, expect, it } from 'vitest';
import { createIauConstellationLookup } from '../../../src/astro-core/iau-geometry/iau-boundaries-pure';
import { decodeRegionGrid, encodeRegionGrid } from '../../../src/catalog-format/boundaries/boundaries-artifact-pure';
import { iauEdgeRecords } from '../parse/constellations/constellations';
import { STELLARIUM } from '../parse/constellations/stellarium-source';

describe('region grid wire', () => {
  const real = createIauConstellationLookup(iauEdgeRecords(STELLARIUM.read())).grid;

  it('round-trips the real grid through the run-length encoding', () => {
    const wire = encodeRegionGrid(real);
    expect(decodeRegionGrid(wire).cellCon).toEqual(real.cellCon);
    // Regions are contiguous blocks of columns, which is the whole reason a
    // 47k-cell grid is affordable on the wire at all.
    expect(wire.runs.length / 2).toBeLessThan(real.cellCon.length / 10);
    expect(wire.codes).toHaveLength(new Set(real.cellCon).size);
  });

  // `constellationEdgeCodeAt` bisects these bounds, so a rounded bound is a
  // moved wall — the runtime would then answer a different constellation from
  // the byte 34 this same grid assigned for a position near one.
  it('carries the bounds at full precision', () => {
    const wire = encodeRegionGrid(real);
    expect(wire.raDeg).toEqual(real.raBoundsDeg);
    expect(wire.decDeg).toEqual(real.decBoundsDeg);
    expect(JSON.parse(JSON.stringify(wire)).raDeg).toEqual(real.raBoundsDeg);
  });

  it('rejects runs that do not tile the grid rather than leaving holes', () => {
    const wire = encodeRegionGrid(real);
    expect(() => decodeRegionGrid({ ...wire, runs: wire.runs.slice(0, -2) }))
      .toThrow(/is malformed/);
    expect(() => decodeRegionGrid({ ...wire, runs: [...wire.runs, 1, 0] }))
      .toThrow(/tile the grid/);
    expect(() => decodeRegionGrid({ ...wire, codes: [] })).toThrow(/missing bounds/);
    // A code index past the table would decode to `undefined` cells, which
    // resolve as a constellation named "undefined".
    const outOfRange = [...wire.runs];
    outOfRange[1] = wire.codes.length;
    expect(() => decodeRegionGrid({ ...wire, runs: outOfRange })).toThrow(/is malformed/);
  });
});
