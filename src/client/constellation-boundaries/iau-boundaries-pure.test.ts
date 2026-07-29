import { describe, expect, it } from 'vitest';

import { CON_INDEX, readIauEdgeRecords } from '../../../scripts/catalog/parse/constellations';
import { raDecFromUnitVector } from '../util/equatorial-basis';
import { B1875_JD, precessRaDec, precessionRotationFromJ2000 } from '../util/precession';
import {
  IAU_REGION_COUNT,
  POLYLINE_MAX_STEP_DEG,
  angularDistanceToNearestEdgeDeg,
  buildBoundaryPolylines,
  constellationEdgeCodeAt,
  constellationKey,
  createIauConstellationLookup,
  createNearestEdgeIndex,
  parseIauEdges,
} from './iau-boundaries-pure';

const records = readIauEdgeRecords();
const lookup = createIauConstellationLookup(records);
const { edges, grid } = lookup;
const B1875 = precessionRotationFromJ2000(B1875_JD);

/** The 20h08m30s Aquila/Delphinus meridian — the wall rho Aql crossed. */
const AQL_DEL_WALL_RA_DEG = 302.125;

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

  it('resolves every assignment into the IAU-88 table', () => {
    const keys = new Set(grid.cellCon.map(constellationKey));
    expect(keys.size).toBe(88);
    for (const key of keys) expect(CON_INDEX.get(key)).toBeTypeOf('number');
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
    expect(lookup.edgeCodeAt({ raDeg, decDeg })).toBe(con);
  });

  // ρ Aquilae is the documented boundary-crossing case and the reason the
  // designation constellation has to be carried separately from the
  // positional one: IAU nomenclature keeps it in Aquila, its position is in
  // Delphinus. See README.md § ρ Aquilae.
  it('places rho Aql (HIP 99742) in Delphinus, not Aquila', () => {
    const rhoAql = { raDeg: 303.5692452, decDeg: 15.19760993 };
    expect(lookup.edgeCodeAt(rhoAql)).toBe('DEL');

    const b1875 = precessRaDec(B1875, rhoAql);
    expect(b1875.raDeg).toBeCloseTo(302.1251, 4);
    expect(b1875.decDeg).toBeCloseTo(14.8200, 4);

    // The margin past the wall, walked back through the star's own proper
    // motion, dates the crossing — which is published as 1992.
    const marginArcsec = (b1875.raDeg - AQL_DEL_WALL_RA_DEG) * 3600;
    expect(marginArcsec).toBeCloseTo(0.381, 3);
    const raMotionArcsecPerYear = 0.055446 / Math.cos((15.19760993 * Math.PI) / 180);
    expect(2000 - marginArcsec / raMotionArcsecPerYear).toBeCloseTo(1993.4, 1);
  });
});

describe('the J2000-bound lookup', () => {
  // Skipping the rotation and querying the B1875 grid with a J2000 position
  // resolves to a real constellation — the wrong one. That is why the epoch is
  // bound into the lookup instead of left to each caller.
  it.each([
    { raDeg: 20, decDeg: -60, precessed: 'TUC', unprecessed: 'HYI' },
    { raDeg: 178, decDeg: -60, precessed: 'CEN', unprecessed: 'CRU' },
    { raDeg: 264, decDeg: -60, precessed: 'ARA', unprecessed: 'PAV' },
  ])('reads $precessed at ($raDeg, $decDeg), not the unprecessed $unprecessed', (c) => {
    const at = { raDeg: c.raDeg, decDeg: c.decDeg };
    expect(lookup.edgeCodeAt(at)).toBe(c.precessed);
    expect(constellationEdgeCodeAt(grid, at)).toBe(c.unprecessed);
  });

  it('collapses Serpens onto the IAU-88 key while edgeCodeAt keeps the part', () => {
    const unukalhai = { raDeg: 236.06699, decDeg: 6.42562 };
    expect(lookup.edgeCodeAt(unukalhai)).toBe('SER1');
    expect(lookup.keyAt(unukalhai)).toBe('ser');
  });
});

describe('distance to the nearest boundary', () => {
  it('is zero on a wall and grows inward', () => {
    // The Aql/Del meridian, mid-span.
    expect(angularDistanceToNearestEdgeDeg(edges, { raDeg: AQL_DEL_WALL_RA_DEG, decDeg: 12 }))
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

  // A constant-RA arc lies in a great circle that also carries the
  // antimeridian and both poles. Gating the perpendicular-foot branch on the
  // point's own declination measures to that far half, which reports a wall as
  // touching when it is a fifth of the sky away.
  it('never measures to the antimeridian half of a meridian great circle', () => {
    const single = parseIauEdges(['1:2 M+ 00:00:00 +70:00:00 00:00:00 +85:00:00 AAA BBB']);
    // Same great circle, opposite side: 180 − 75 − 85 of arc between them.
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 180, decDeg: 75 }))
      .toBeCloseTo(20, 9);
    // A quarter turn away in RA, dec inside the arc's span: the foot is at the
    // pole, so the dec-85 endpoint wins.
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 90, decDeg: 84.9 }))
      .toBeCloseTo(7.1375, 4);
    // Foot just past the arc's end — the endpoint, not the great circle.
    expect(angularDistanceToNearestEdgeDeg(single, { raDeg: 30, decDeg: 84.99 }))
      .toBeCloseTo(2.5877, 4);
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

  // Pinned exactly rather than bounded: these values agree with a brute-force
  // sample of every arc to 1e-6°, so a drift is a geometry regression. A range
  // check passes just as well when the meridian branch measures to the wrong
  // half of its great circle.
  it.each([
    { name: 'Betelgeuse', raDeg: 88.79293899, decDeg: 7.40706400, nearestDeg: 5.152051 },
    { name: 'Sirius', raDeg: 101.28715533, decDeg: -16.71611586, nearestDeg: 5.588200 },
    { name: 'Vega', raDeg: 279.23473479, decDeg: 38.78368896, nearestDeg: 4.338363 },
    { name: 'Polaris', raDeg: 37.95456067, decDeg: 89.26410897, nearestDeg: 0.642569 },
  ])('puts $name $nearestDeg° inside its nearest wall', ({ raDeg, decDeg, nearestDeg }) => {
    expect(lookup.distanceToNearestEdgeDeg({ raDeg, decDeg })).toBeCloseTo(nearestDeg, 6);
  });
});

describe('the dec-banded nearest-edge index', () => {
  // The index prunes on a lower bound, so it must be exactly equivalent to the
  // linear scan — not merely close. A sampling grid rather than spot checks:
  // the pruning bug that matters is an arc a band short of where it belongs,
  // which only shows up for queries in that band.
  it('agrees with the linear scan everywhere on the sphere', () => {
    const index = createNearestEdgeIndex(edges);
    let worstDelta = 0;
    for (let decDeg = -89.5; decDeg <= 89.5; decDeg += 1.7) {
      for (let raDeg = 0; raDeg < 360; raDeg += 3.1) {
        const at = { raDeg, decDeg };
        worstDelta = Math.max(
          worstDelta,
          Math.abs(index.distanceDeg(at) - angularDistanceToNearestEdgeDeg(edges, at)),
        );
      }
    }
    expect(worstDelta).toBe(0);
  });

  it('reaches an arc bucketed several bands from the query', () => {
    // One short arc near the pole and a query 20° of declination away: the
    // walk has to keep expanding past 20 empty bands rather than stopping at
    // the first that holds nothing.
    const single = parseIauEdges(['1:2 P+ 00:00:00 +80:00:00 06:00:00 +80:00:00 AAA BBB']);
    expect(createNearestEdgeIndex(single).distanceDeg({ raDeg: 45, decDeg: 60 }))
      .toBeCloseTo(20, 9);
  });
});

describe('boundary polylines', () => {
  const polylines = buildBoundaryPolylines(edges);

  it('emits one flat, deduped arc per edge record', () => {
    expect(polylines).toHaveLength(edges.meridians.length + edges.parallels.length);
    expect(polylines.filter((p) => p.kind === 'M')).toHaveLength(edges.meridians.length);
    expect(polylines.filter((p) => p.kind === 'P')).toHaveLength(edges.parallels.length);
    expect(polylines.every((p) => p.directions.length >= 2)).toBe(true);
  });

  it('round-trips every sample back onto its source arc', () => {
    // Un-precessing a sample must land it back on the constant-RA or
    // constant-Dec line it was drawn from. A wrong rotation direction still
    // produces a plausible sphere-covering curve set, so this is the check
    // that the emitted frame really is ICRS.
    const arcsecTolerance = 1 / 3600;
    let worstOffAxisDeg = 0;
    polylines.forEach((polyline, i) => {
      const source = polyline.kind === 'M'
        ? { axis: 'ra' as const, value: edges.meridians[i].raDeg }
        : { axis: 'dec' as const, value: edges.parallels[i - edges.meridians.length].decDeg };
      for (const dir of polyline.directions) {
        const back = precessRaDec(B1875, raDecFromUnitVector(dir));
        const got = source.axis === 'ra' ? back.raDeg : back.decDeg;
        // An arc at RA 0 comes back at 359.999…, so RA compares modulo a turn.
        const delta = source.axis === 'ra'
          ? Math.abs(((got - source.value + 540) % 360) - 180)
          : Math.abs(got - source.value);
        worstOffAxisDeg = Math.max(worstOffAxisDeg, delta);
      }
    });
    expect(worstOffAxisDeg).toBeLessThan(arcsecTolerance);
  });

  it('keeps every sample step under the subdivision cap', () => {
    let worstStepDeg = 0;
    for (const polyline of polylines) {
      for (let i = 1; i < polyline.directions.length; i++) {
        const a = polyline.directions[i - 1];
        const b = polyline.directions[i];
        const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
        worstStepDeg = Math.max(worstStepDeg, Math.acos(dot) * (180 / Math.PI));
      }
    }
    expect(worstStepDeg).toBeLessThanOrEqual(POLYLINE_MAX_STEP_DEG + 1e-9);
  });

  // Subdivision is load-bearing, not a smoothness nicety: a constant-Dec arc
  // is a SMALL circle in B1875, and precession maps it to a curve that leaves
  // the straight chord between its precessed endpoints. Dropping subdivision
  // as an "optimisation" would cut the drawn boundary inside the real one by
  // this much.
  it('puts a parallel midpoint measurably off the chord between its endpoints', () => {
    const widest = polylines
      .filter((p) => p.kind === 'P')
      .reduce((best, p) => (p.directions.length > best.directions.length ? p : best));
    const first = widest.directions[0];
    const last = widest.directions[widest.directions.length - 1];
    const mid = widest.directions[(widest.directions.length - 1) >> 1];
    // Angle from the mid sample to the plane of the two endpoints.
    const normal = {
      x: first.y * last.z - first.z * last.y,
      y: first.z * last.x - first.x * last.z,
      z: first.x * last.y - first.y * last.x,
    };
    const norm = Math.hypot(normal.x, normal.y, normal.z);
    const outOfPlane = Math.abs(
      (mid.x * normal.x + mid.y * normal.y + mid.z * normal.z) / norm,
    );
    const departureDeg = Math.asin(Math.min(1, outOfPlane)) * (180 / Math.PI);
    expect(departureDeg).toBeGreaterThan(1);
  });

  it('does not smooth a meridian off its own great circle', () => {
    // Meridians ARE great circles and precession is a pure rotation, so every
    // sample of one shares a plane. This is the contrast case: the parallel
    // departure above is geometry, not a subdivision artifact.
    const widest = polylines
      .filter((p) => p.kind === 'M')
      .reduce((best, p) => (p.directions.length > best.directions.length ? p : best));
    const first = widest.directions[0];
    const last = widest.directions[widest.directions.length - 1];
    const mid = widest.directions[(widest.directions.length - 1) >> 1];
    const normal = {
      x: first.y * last.z - first.z * last.y,
      y: first.z * last.x - first.x * last.z,
      z: first.x * last.y - first.y * last.x,
    };
    const norm = Math.hypot(normal.x, normal.y, normal.z);
    expect(Math.abs((mid.x * normal.x + mid.y * normal.y + mid.z * normal.z) / norm))
      .toBeLessThan(1e-12);
  });

  it('emits unit directions', () => {
    for (const polyline of polylines) {
      for (const d of polyline.directions) {
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
      }
    }
  });

  it('starts the Aql/Del meridian on its own wall', () => {
    const idx = edges.meridians.findIndex(
      (e) => Math.abs(e.raDeg - AQL_DEL_WALL_RA_DEG) < 1e-9 && e.conA === 'DEL' && e.conB === 'AQL',
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    const head = polylines[idx].directions[0];
    const b1875 = precessRaDec(B1875, raDecFromUnitVector(head));
    expect(b1875.raDeg).toBeCloseTo(AQL_DEL_WALL_RA_DEG, 6);
    // And the ICRS direction is NOT at the B1875 RA — precession moved it.
    expect(Math.abs(raDecFromUnitVector(head).raDeg - AQL_DEL_WALL_RA_DEG))
      .toBeGreaterThan(1.5);
  });
});
