import { describe, expect, it } from 'vitest';

import { allocate, type Admission, type SidObject } from './allocate-pure';
import {
  ALLOCATION_CODES, allocationAdmissionCode, allocationSids, allocationSidRows, allocationSidsText, allocationLineageRows,
  allocationSummary,
} from './allocation-lineage-pure';
import { SEEDED_BRANCH, seededCodeCheck } from '../catalog/lineage/count-block-fixture';
import { foldStageLines, stageLineageLine } from '../catalog/lineage/lineage-row-pure';

const objects: SidObject[] = [
  { designations: ['hip:1'], kind: 'star', label: 'a', origin: 'spine:1', admission: { kind: 'lineage' } },
  { designations: ['cloud:x'], kind: 'cloud', label: 'x', origin: 'clouds:x', admission: { kind: 'declared', code: 'allocation.mint.cloud' } },
  { designations: ['sol:pluto'], kind: 'planet', label: 'p', origin: 'sol-objects:pluto', admission: { kind: 'declared', code: 'allocation.mint.sol-list' } },
];

const allocation = allocate({
  objects,
  storedEdges: [],
  ledger: [
    { sid: 1, canonicalKey: 'hip:1', kind: 'star', firstSeen: '2026-07-01' },
    { sid: 2, canonicalKey: 'gaia_dr3:2', kind: 'star', firstSeen: '2026-07-01' },
  ],
  events: [],
  scope: () => true,
  date: '2026-11-01',
  version: '7.1.8',
}, {
  causes: () => new Map([['gaia_dr3:2', {
    decisions: [{ stage: 'placement', origin: 'spine:7', code: 'placement.park.no-position', effect: 'park', into: null }],
    seenBy: ['membership'],
  }]]),
  admissions: () => new Map(),
});
if (allocation.kind !== 'allocated') throw new Error(allocation.errors.join('\n'));

describe('allocation lineage', () => {
  it('writes a row per object and per settled SID, each a declared code', () => {
    const rows = allocationLineageRows(objects, allocation);
    expect(rows.map((r) => [r.key, r.code, r.params])).toEqual([
      ['spine:1', 'allocation.resolved', ''],
      ['clouds:x', 'allocation.minted', '{"canonical_key":"cloud:x","route":"allocation.mint.cloud"}'],
      ['sol-objects:pluto', 'allocation.minted', '{"canonical_key":"sol:pluto","route":"allocation.mint.sol-list"}'],
      ['spine:7', 'allocation.parked', '{"sid":"2","canonical_key":"gaia_dr3:2","cause":"placement.park.no-position"}'],
    ]);
    for (const r of rows) stageLineageLine(ALLOCATION_CODES, r);
  });

  it('keys its counts on its row codes; the mint codes are admission codes, a minted row\'s route', () => {
    expect(ALLOCATION_CODES.live).toEqual([
      'allocation.resolved', 'allocation.minted', 'allocation.reinstated', 'allocation.merged',
      'allocation.merged.same-class', 'allocation.retired', 'allocation.parked',
    ]);
    for (const branch of ['mint.sol-list', 'mint.shell-list', 'mint.cloud', 'mint.local-group'] as const) {
      expect(ALLOCATION_CODES.onRows(allocationAdmissionCode(branch))).toBe(false);
    }
  });

  it('admits a declared object only under an admission code, in the type', () => {
    const admitted: Admission = { kind: 'declared', code: allocationAdmissionCode('mint.cloud') };
    // @ts-expect-error a row code is no admission code
    const refused: Admission = { kind: 'declared', code: ALLOCATION_CODES.code('resolved') };
    // @ts-expect-error a row code is no admission branch
    const unreachable = () => allocationAdmissionCode('resolved');
    expect([admitted.kind, refused.kind, typeof unreachable]).toEqual(['declared', 'declared', 'function']);
  });

  it('folds its rows into its count block, a minted row once whatever its route', () => {
    const lines = allocationLineageRows(objects, allocation).map((r) => stageLineageLine(ALLOCATION_CODES, r));
    expect(foldStageLines(ALLOCATION_CODES, lines)).toEqual({
      'allocation.resolved': 1, 'allocation.minted': 2, 'allocation.reinstated': 0, 'allocation.merged': 0,
      'allocation.merged.same-class': 0, 'allocation.retired': 0, 'allocation.parked': 1,
    });
  });

  it('summarises its count block for the build log, each merge code apart', () => {
    const lines = allocationLineageRows(objects, allocation).map((r) => stageLineageLine(ALLOCATION_CODES, r));
    expect(allocationSummary(foldStageLines(ALLOCATION_CODES, lines), 2)).toBe(
      'SID allocation: 3 objects, 2 minted, 0 reinstated; 1 parked, 0 retired, 0 merged, 0 merged by same-as class; 2 new event(s)',
    );
  });

  it('fails its snapshot check on a new code until the snapshot is refreshed', () => {
    const lines = allocationLineageRows(objects, allocation).map((r) => stageLineageLine(ALLOCATION_CODES, r));
    const { drift, refreshed } = seededCodeCheck(ALLOCATION_CODES, lines);
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`allocation.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });

  it('round-trips its identity file, key to SID', () => {
    const rows = allocationSidRows(objects, allocation.outcomes);
    const text = allocationSidsText(rows);
    expect(text).toBe('key\tsid\nclouds:x\t3\nsol-objects:pluto\t4\nspine:1\t1\n');
    expect([...allocationSids(text, 'fixture')]).toEqual([
      { key: 'clouds:x', sid: 3 }, { key: 'sol-objects:pluto', sid: 4 }, { key: 'spine:1', sid: 1 },
    ]);
  });
});
