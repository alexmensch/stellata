// A multiples.tsv row as promotion reads it: the record's fields with its Stage 6 anchor offset already parsed.

import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import type { GaiaFields, HipFields, MultiplesRecord, MultiplesRecordFields } from '../../binaries/multiples-record-pure';
import { readArtifact } from '../../util/sources/source';
import { parseStage6Offset, type Stage6Offset } from './placement/anchor-offset-pure';

export type MultiplesTsvRow = Omit<MultiplesRecordFields, 'anchorSepArcsec' | 'anchorPaDeg'> & GaiaFields & HipFields & {
  anchorOffset: Stage6Offset;
};

/** Source_ids whose system names more than one component, so the pair's other
 *  component has a record of its own for a second HD number to belong to.
 *
 *  Keyed on the system rather than on the source_id, because a secondary
 *  routinely carries its own source_id or none at all — grouping by source_id
 *  misses the sibling on exactly the resolved pairs this is asked about.
 *  Promotion can still decline to render a member row, so this is a superset of
 *  what ships; the label merge wants that direction
 *  (`../classic-ids/label-merge/README.md#an-alias-stops-at-the-blend`). */
export function sourceIdsWithSiblingComponent(
  rows: readonly MultiplesTsvRow[],
): Set<string> {
  const componentsBySystem = new Map<string, Set<string>>();
  for (const row of rows) {
    let comps = componentsBySystem.get(row.systemId);
    if (comps === undefined) componentsBySystem.set(row.systemId, (comps = new Set()));
    comps.add(row.comp);
  }
  const out = new Set<string>();
  for (const row of rows) {
    if (row.gaiaSourceId === null) continue;
    if ((componentsBySystem.get(row.systemId)?.size ?? 0) > 1) out.add(row.gaiaSourceId);
  }
  return out;
}

export function promotionRow(record: MultiplesRecord): MultiplesTsvRow {
  const { anchorSepArcsec, anchorPaDeg, ...rest } = record;
  return {
    ...rest,
    anchorOffset: parseStage6Offset(record.comp, record.anchorComp, anchorSepArcsec, anchorPaDeg),
  };
}

export function parseMultiplesTsv(text: string): MultiplesTsvRow[] {
  return MULTIPLES_TSV.parse(text).map(promotionRow);
}

export function readMultiplesTsv(): MultiplesTsvRow[] {
  return readArtifact(MULTIPLES_TSV).map(promotionRow);
}
