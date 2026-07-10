import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import {
  ACCEPT_MAS,
  MAG_REVIEW_DELTA,
  classifyDrTransition,
  readNeighbourhoodRows,
  readRiskIds,
  type NeighbourhoodRow,
} from './dr-reconcile-pure';
import { isLfsPointer } from './sid-pure';

describe('classifyDrTransition', () => {
  const row = (
    riskId: bigint,
    candidateId: bigint,
    dist: number,
    dmag: number | null = 0,
  ): NeighbourhoodRow => ({
    riskId,
    candidateId,
    angularDistanceMas: dist,
    magnitudeDifference: dmag,
  });

  it('classifies carried / contested / near-miss / no-rows per risk id', () => {
    const c = classifyDrTransition(
      [1n, 2n, 3n, 4n],
      [
        row(1n, 1n, 10),
        row(1n, 99n, 900),
        row(2n, 20n, 500),
        row(4n, 40n, 10),
        row(4n, 41n, 20),
      ],
    );
    expect(c.carried.map((m) => m.riskId)).toEqual([1n]);
    expect(c.carriedSameId).toBe(1);
    expect(c.droppedNearMiss).toEqual([2n]);
    expect(c.droppedNoRows).toEqual([3n]);
    expect(c.contested.map((x) => x.riskId)).toEqual([4n]);
  });

  it('accepts exactly at the ACCEPT_MAS boundary', () => {
    const c = classifyDrTransition([1n], [row(1n, 2n, ACCEPT_MAS)]);
    expect(c.carried).toHaveLength(1);
  });

  it('groups risk ids that accepted the same candidate (split/merge review)', () => {
    const c = classifyDrTransition([5n, 6n], [row(5n, 100n, 5), row(6n, 100n, 8)]);
    expect(c.sharedCandidateGroups).toEqual([{ candidateId: 100n, riskIds: [5n, 6n] }]);
  });

  it('flags carried matches with |Δmag| beyond the review threshold', () => {
    const c = classifyDrTransition(
      [1n, 2n, 3n],
      [row(1n, 1n, 1, MAG_REVIEW_DELTA + 0.5), row(2n, 2n, 1, -MAG_REVIEW_DELTA - 0.5), row(3n, 3n, 1, null)],
    );
    expect(c.magFlagged.map((m) => m.riskId)).toEqual([1n, 2n]);
  });
});

// End-to-end pin of the DR2→DR3 dry run (docs/sid.md § 6.2) against the
// committed request + neighbourhood snapshots. Self-skips where those LFS
// files are pointer stubs (the bare CI test job); runs in the
// build-catalog job and locally.
const REQUEST = resolve(REPO_ROOT, 'data/gaia/gaia_dr2_neighbourhood_request.tsv');
const NEIGHBOURHOOD = resolve(REPO_ROOT, 'data/gaia/gaia_dr2_neighbourhood.tsv');
const available =
  existsSync(REQUEST) &&
  existsSync(NEIGHBOURHOOD) &&
  !isLfsPointer(readFileSync(REQUEST, 'utf-8')) &&
  !isLfsPointer(readFileSync(NEIGHBOURHOOD, 'utf-8'));

describe.skipIf(!available)('DR2→DR3 dry run (committed snapshot)', () => {
  it('reproduces the docs/sid.md § 6.2 classification exactly', () => {
    const riskIds = readRiskIds(readFileSync(REQUEST, 'utf-8'));
    const rows = readNeighbourhoodRows(
      readFileSync(NEIGHBOURHOOD, 'utf-8'),
      'dr3_source_id',
      'dr2_source_id',
    );
    expect(riskIds).toHaveLength(5085);
    expect(rows).toHaveLength(5912);

    const c = classifyDrTransition(riskIds, rows);
    expect(c.carried).toHaveLength(4852);
    expect(c.carriedSameId).toBe(4469);
    expect(c.magFlagged).toHaveLength(12);
    expect(c.contested).toHaveLength(0);
    expect(c.sharedCandidateGroups).toHaveLength(2);
    expect(c.sharedCandidateGroups.reduce((n, g) => n + g.riskIds.length, 0)).toBe(4);
    expect(c.droppedNearMiss).toHaveLength(177);
    expect(c.droppedNoRows).toHaveLength(56);
    // docs/sid.md § 6.2 prints these at 1 dp: 0.2 / 2.5 / 108.2 / 375.9.
    expect(c.distanceQuantiles).toEqual({ p50: 0.195, p90: 2.511, p99: 108.231, max: 375.914 });
  });
});
