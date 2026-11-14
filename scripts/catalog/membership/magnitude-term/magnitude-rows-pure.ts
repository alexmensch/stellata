// The union's magnitude side: one manifest row per kept source no primaries row binds. See README.md#the-union-dedupes-on-the-derived-binding.

import type { OwnCandidate } from '../ledger-rows-pure';
import type { KeyedOutcome } from '../membership-lineage-pure';
import { magnitudeManifestRecord, type ManifestRecord } from '../membership-manifest-tsv';
import { magnitudeTermNewcomers, type MagnitudeTermSelection } from './magnitude-term-pure';

/** `ownCandidates` names, by source, the primaries row that proposed a newcomer
 *  and did not ship it. */
export function magnitudeTermRows(
  selection: MagnitudeTermSelection | null,
  primariesRows: readonly ManifestRecord[],
  ownCandidates: ReadonlyMap<string, OwnCandidate>,
  gaiaKey: (sourceId: string) => string,
): { rows: ManifestRecord[]; outcomes: KeyedOutcome[] } {
  const bound = new Set(primariesRows.flatMap((r) => (r.gaiaSourceId === null ? [] : [r.gaiaSourceId])));
  const rows: ManifestRecord[] = [];
  const outcomes: KeyedOutcome[] = [];
  for (const sourceId of magnitudeTermNewcomers(selection?.keptSourceIds ?? new Set(), bound)) {
    const key = gaiaKey(sourceId);
    rows.push(magnitudeManifestRecord(sourceId, key));
    outcomes.push({ key, outcome: { kind: 'admit-magnitude', ownCandidate: ownCandidates.get(sourceId) ?? null } });
  }
  return { rows, outcomes };
}
