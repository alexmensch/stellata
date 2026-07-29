import { describe, expect, it } from 'vitest';

import { unitVectorFromRaDec } from '../../../src/client/util/equatorial-basis';
import {
  CONSTELLATIONS,
  createConstellationAssignment,
  readIauEdgeRecords,
} from './constellations';

const conIndexOf = (code: string): number =>
  CONSTELLATIONS.findIndex((c) => c.code.toLowerCase() === code);

describe('createConstellationAssignment', () => {
  const assignment = createConstellationAssignment();

  it('resolves a position into the IAU-88 index space', () => {
    // Sirius: 06h45m09s −16°42'58". Distance is irrelevant — only direction.
    const v = unitVectorFromRaDec(101.287, -16.716);
    for (const scale of [1, 1e-4, 4.7e3]) {
      expect(assignment.indexAt(v.x * scale, v.y * scale, v.z * scale))
        .toBe(conIndexOf('cma'));
    }
  });

  it('throws at the origin rather than answering', () => {
    // Sol's own record takes the sentinel through a caller-side is-Sol branch;
    // anything else arriving here with no direction is a bug, and companion
    // promotion calls indexAt unguarded.
    expect(() => assignment.indexAt(0, 0, 0))
      .toThrow(/origin has no sky direction/);
  });

  it('rejects an edge set naming a constellation the IAU-88 table lacks', () => {
    // The edge set and the table are independent sources. A region the table
    // cannot name would otherwise ship the unclassified sentinel over a real
    // patch of sky, which surfaces as a blank Constellation row, not an error.
    //
    // Renaming one code across the real records is the only way in: a
    // synthetic fixture trips buildConstellationRegions' own 89-region
    // invariant long before this check, so the reachable failure is exactly
    // this one — a swapped edge set that still decomposes cleanly but names a
    // constellation the table has never heard of (an Argo Navis-era set).
    const renamed = readIauEdgeRecords().map((r) => r.replace(/\bMEN\b/g, 'ZZZ'));
    expect(renamed.join('\n')).toContain('ZZZ');
    expect(() => createConstellationAssignment(renamed))
      .toThrow(/absent from the IAU-88 table: ZZZ/);
  });

  it('shares one decomposition with the boundary artifact', () => {
    // The artifact builder draws its arcs from this same lookup, so byte 34
    // and the drawn boundaries cannot disagree.
    expect(assignment.lookup.edges.meridians.length
      + assignment.lookup.edges.parallels.length).toBe(781);
  });

  it('reads the committed edge set by default', () => {
    expect(createConstellationAssignment(readIauEdgeRecords()).indexAt(1, 0, 0))
      .toBe(assignment.indexAt(1, 0, 0));
  });
});
