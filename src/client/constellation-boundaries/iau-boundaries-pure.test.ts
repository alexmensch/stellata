import { describe, expect, it } from 'vitest';

import { readIauEdgeRecords } from '../../../scripts/catalog/parse/constellations';
import { B1875_JD, precessRaDec, precessionRotationFromJ2000 } from '../util/precession';
import {
  IAU_REGION_COUNT,
  angularDistanceToNearestEdgeDeg,
  buildConstellationRegions,
  constellationEdgeCodeAt,
  constellationKey,
  parseIauEdges,
} from './iau-boundaries-pure';

const records = readIauEdgeRecords();
const edges = parseIauEdges(records);
const grid = buildConstellationRegions(edges);
const B1875 = precessionRotationFromJ2000(B1875_JD);

const constellationAtJ2000 = (raDeg: number, decDeg: number) =>
  constellationEdgeCodeAt(grid, precessRaDec(B1875, { raDeg, decDeg }));

describe('IAU edge records', () => {
  it('decompose into meridians and parallels', () => {
    expect(records).toHaveLength(781);
    expect(edges.meridians).toHaveLength(389);
    expect(edges.parallels).toHaveLength(392);
  });

  it('reject a record whose kind disagrees with its geometry', () => {
    expect(() => parseIauEdges(['001:002 M+ 22:52:00 +34:30:00 23:52:00 +52:30:00 AND LAC']))
      .toThrow(/Meridian edge spans two RA values/);
    expect(() => parseIauEdges(['001:002 P+ 22:52:00 +34:30:00 23:52:00 +52:30:00 AND LAC']))
      .toThrow(/Parallel edge spans two Dec values/);
    expect(() => parseIauEdges(['001:002 X+ 22:52:00 +34:30:00 22:52:00 +52:30:00 AND LAC']))
      .toThrow(/unknown kind/);
    expect(() => parseIauEdges(['001:002 M+ 22:52:00 +34:30:00 AND LAC']))
      .toThrow(/expected 8/);
  });

  it('keeps a parallel arc that crosses RA 0 on its raw endpoints', () => {
    const [wrapping] = parseIauEdges([
      '034:033 P+ 23:45:00 +31:20:00 00:00:00 +31:20:00 PEG AND',
    ]).parallels;
    expect(wrapping.raStartDeg).toBeCloseTo(356.25, 9);
    expect(wrapping.raEndDeg).toBe(0);
  });
});

describe('region decomposition', () => {
  it('yields one uniquely named region per constellation', () => {
    expect(new Set(grid.cellCon).size).toBe(IAU_REGION_COUNT);
    // Every code named on an edge owns a region, so no constellation is lost
    // to a mislabelled component.
    const named = new Set([
      ...edges.meridians.flatMap((e) => [e.conA, e.conB]),
      ...edges.parallels.flatMap((e) => [e.conA, e.conB]),
    ]);
    expect(named).toEqual(new Set(grid.cellCon));
  });

  it('covers the sphere on the cell grid the edge coordinates induce', () => {
    expect(grid.raBoundsDeg).toHaveLength(236);
    expect(grid.decBoundsDeg).toHaveLength(199);
    expect(grid.cellCon).toHaveLength(236 * 200);
    expect(grid.cellCon.every((code) => code.length > 0)).toBe(true);
  });

  it('collapses the polar bands onto one constellation each', () => {
    const columns = grid.raBoundsDeg.length;
    const southCap = new Set(grid.cellCon.slice(0, columns));
    const northCap = new Set(grid.cellCon.slice(-columns));
    expect(southCap).toEqual(new Set(['OCT']));
    expect(northCap).toEqual(new Set(['UMI']));
  });

  it('keeps Serpens split in the edge set and joined in the table key', () => {
    expect(new Set(grid.cellCon).has('SER1')).toBe(true);
    expect(new Set(grid.cellCon).has('SER2')).toBe(true);
    expect(constellationKey('SER1')).toBe('ser');
    expect(constellationKey('SER2')).toBe('ser');
    expect(constellationKey('CMA')).toBe('cma');
  });

  it('resolves a position given in unwrapped RA', () => {
    const orion = { raDeg: 87.2826, decDeg: 7.4309 };
    expect(constellationEdgeCodeAt(grid, orion)).toBe('ORI');
    expect(constellationEdgeCodeAt(grid, { ...orion, raDeg: orion.raDeg + 360 })).toBe('ORI');
    expect(constellationEdgeCodeAt(grid, { ...orion, raDeg: orion.raDeg - 360 })).toBe('ORI');
  });
});

describe('named-star assignment', () => {
  it.each([
    { name: 'Betelgeuse', raDeg: 88.79293899, decDeg: 7.40706400, con: 'ORI' },
    { name: 'Polaris', raDeg: 37.95456067, decDeg: 89.26410897, con: 'UMI' },
    { name: 'Sirius', raDeg: 101.28715533, decDeg: -16.71611586, con: 'CMA' },
    { name: 'Vega', raDeg: 279.23473479, decDeg: 38.78368896, con: 'LYR' },
    { name: 'Antares', raDeg: 247.35191542, decDeg: -26.43200261, con: 'SCO' },
    { name: 'Proxima Centauri', raDeg: 217.42895, decDeg: -62.67948, con: 'CEN' },
    { name: 'Alnitak', raDeg: 85.18969, decDeg: -1.94257, con: 'ORI' },
    { name: 'Unukalhai (Ser Caput)', raDeg: 236.06699, decDeg: 6.42562, con: 'SER1' },
    { name: 'Eta Serpentis (Ser Cauda)', raDeg: 275.32665, decDeg: -2.89880, con: 'SER2' },
  ])('places $name in $con', ({ raDeg, decDeg, con }) => {
    expect(constellationAtJ2000(raDeg, decDeg)).toBe(con);
  });

  // ρ Aquilae is the documented boundary-crossing case and the reason the
  // designation constellation has to be carried separately from the
  // positional one: IAU nomenclature keeps it in Aquila, its position is in
  // Delphinus. See README.md § ρ Aquilae.
  it('places rho Aql (HIP 99742) in Delphinus, not Aquila', () => {
    const rhoAql = { raDeg: 303.5692452, decDeg: 15.19760993 };
    expect(constellationAtJ2000(rhoAql.raDeg, rhoAql.decDeg)).toBe('DEL');

    const b1875 = precessRaDec(B1875, rhoAql);
    expect(b1875.raDeg).toBeCloseTo(302.1251, 4);
    expect(b1875.decDeg).toBeCloseTo(14.8200, 4);

    // The margin past the 20h08m30s wall, walked back through the star's own
    // proper motion, dates the crossing — which is published as 1992.
    const marginArcsec = (b1875.raDeg - 302.125) * 3600;
    expect(marginArcsec).toBeCloseTo(0.381, 3);
    const raMotionArcsecPerYear = 0.055446 / Math.cos((15.19760993 * Math.PI) / 180);
    expect(2000 - marginArcsec / raMotionArcsecPerYear).toBeCloseTo(1993.4, 1);
  });
});

describe('distance to the nearest boundary', () => {
  it('is zero on a wall and grows inward', () => {
    // The 20h08m30s Aql/Del meridian, mid-span.
    expect(angularDistanceToNearestEdgeDeg(edges, { raDeg: 302.125, decDeg: 12 }))
      .toBeCloseTo(0, 9);
    // The +8°30' Aql/Del parallel, mid-span.
    expect(angularDistanceToNearestEdgeDeg(edges, { raDeg: 304, decDeg: 8.5 }))
      .toBeCloseTo(0, 9);
  });

  it('measures a meridian across the sphere, not along a coordinate axis', () => {
    // Both meridian and parallel walls run through the pole's neighbourhood,
    // so a 1° RA offset at dec 80 is only 0.17° of sky.
    const single = parseIauEdges(['1:2 M+ 00:00:00 +70:00:00 00:00:00 +85:00:00 AAA BBB']);
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 1, decDeg: 80 }))
      .toBeCloseTo(0.1736, 4);
    // Beyond the arc's end the nearest point is its endpoint.
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 0, decDeg: 88 }))
      .toBeCloseTo(3, 9);
  });

  it('measures a parallel along the meridian of the point inside the span', () => {
    const single = parseIauEdges(['1:2 P+ 02:00:00 +30:00:00 04:00:00 +30:00:00 AAA BBB']);
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 45, decDeg: 34 }))
      .toBeCloseTo(4, 9);
    // Past the eastern end, the endpoint wins over the small-circle drop.
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 61, decDeg: 30 }))
      .toBeCloseTo(0.866, 4);
  });

  it('handles a parallel spanning RA 0', () => {
    const single = parseIauEdges(['1:2 P+ 23:00:00 +10:00:00 01:00:00 +10:00:00 AAA BBB']);
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 0, decDeg: 13 }))
      .toBeCloseTo(3, 9);
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 359, decDeg: 13 }))
      .toBeCloseTo(3, 9);
  });

  it('stays inside the boundary that owns each named star', () => {
    for (const star of [
      { raDeg: 88.79293899, decDeg: 7.40706400 },
      { raDeg: 101.28715533, decDeg: -16.71611586 },
      { raDeg: 279.23473479, decDeg: 38.78368896 },
    ]) {
      const at = precessRaDec(B1875, star);
      expect(angularDistanceToNearestEdgeDeg(edges, at)).toBeGreaterThan(0);
      expect(angularDistanceToNearestEdgeDeg(edges, at)).toBeLessThan(30);
    }
  });
});
