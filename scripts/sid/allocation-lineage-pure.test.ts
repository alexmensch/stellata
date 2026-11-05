import { describe, expect, it } from 'vitest';

import { allocate, type SidObject } from './allocate-pure';
import {
  ALLOCATION_CODES, allocationSids, allocationSidRows, allocationSidsText, allocationLineageRows,
} from './allocation-lineage-pure';
import { stageLineageLine } from '../catalog/lineage/lineage-row-pure';

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

  it('round-trips its identity file, key to SID', () => {
    const rows = allocationSidRows(objects, allocation.outcomes);
    const text = allocationSidsText(rows);
    expect(text).toBe('key\tsid\nclouds:x\t3\nsol-objects:pluto\t4\nspine:1\t1\n');
    expect([...allocationSids(text, 'fixture')]).toEqual([
      { key: 'clouds:x', sid: 3 }, { key: 'sol-objects:pluto', sid: 4 }, { key: 'spine:1', sid: 1 },
    ]);
  });
});
