import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../util/paths';
import {
  ACCEPT_MAS,
  DR2_DRY_RUN,
  MAG_REVIEW_DELTA,
  classifyDrTransition,
  readNeighbourhoodRows,
  readRiskIds,
  type NeighbourhoodRow,
} from './dr-reconcile-pure';

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

describe('readRiskIds', () => {
  it('reads the request column as source_ids, naming file and line on a bad one', () => {
    expect(readRiskIds('gaia_source_id\n12\n34\n', 'r.tsv')).toEqual([12n, 34n]);
    expect(() => readRiskIds('gaia_source_id\n12\n\t\n-3\n', 'r.tsv')).toThrow(/^r\.tsv:4: gaia_source_id: "-3" is not a source_id/);
    expect(() => readRiskIds('source_id\n12\n', 'r.tsv')).toThrow(/r\.tsv is missing required columns: gaia_source_id/);
  });
});

describe('readNeighbourhoodRows', () => {
  const header = 'dr3_source_id\tdr2_source_id\tangular_distance\tmagnitude_difference';

  it('reads both id columns as source_ids', () => {
    expect(readNeighbourhoodRows(`${header}\n12\t34\t1.5\t\n`, 'dr3_source_id', 'dr2_source_id', 'n.tsv'))
      .toEqual([{ riskId: 12n, candidateId: 34n, angularDistanceMas: 1.5, magnitudeDifference: null }]);
  });

  it('names file, line and column on an id that is not a source_id', () => {
    expect(() => readNeighbourhoodRows(`${header}\n12\t\t1.5\t\n`, 'dr3_source_id', 'dr2_source_id', 'n.tsv'))
      .toThrow(/^n\.tsv:2: dr2_source_id: is empty/);
    expect(() => readNeighbourhoodRows(`${header}\n1e3\t34\t1.5\t\n`, 'dr3_source_id', 'dr2_source_id', 'n.tsv'))
      .toThrow(/^n\.tsv:2: dr3_source_id: "1e3" is not a source_id/);
  });
});

// End-to-end pin of the DR2→DR3 dry run (/docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07) against the
// committed request + neighbourhood snapshots. Self-skips where those LFS
// files are pointer stubs (the bare CI test job); runs in the
// SID-ledger-guard job and locally.
const REQUEST = resolve(REPO_ROOT, DR2_DRY_RUN.request);
const NEIGHBOURHOOD = resolve(REPO_ROOT, DR2_DRY_RUN.neighbourhood);
const available = lfsContentReadable(REQUEST) && lfsContentReadable(NEIGHBOURHOOD);

describe.skipIf(!available)('DR2→DR3 dry run (committed snapshot)', () => {
  it('reproduces the /docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07 classification exactly', () => {
    const riskIds = readRiskIds(readFileSync(REQUEST, 'utf-8'), DR2_DRY_RUN.request);
    const rows = readNeighbourhoodRows(
      readFileSync(NEIGHBOURHOOD, 'utf-8'),
      'dr3_source_id',
      'dr2_source_id',
      DR2_DRY_RUN.neighbourhood,
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
    // /docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07 prints these at 1 dp: 0.2 / 2.5 / 108.2 / 375.9.
    expect(c.distanceQuantiles).toEqual({ p50: 0.195, p90: 2.511, p99: 108.231, max: 375.914 });
  });
});
