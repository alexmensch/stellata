// A multiples.tsv row as promotion reads it: the record's fields with its Stage 6 anchor offset already parsed.

import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import type { GaiaFields, HipFields, MultiplesRecord, MultiplesRecordFields } from '../../binaries/multiples-record-pure';
import { readArtifact } from '../../util/sources/source';
import { parseStage6Offset, type Stage6Offset } from './placement/anchor-offset-pure';

export type MultiplesTsvRow = Omit<MultiplesRecordFields, 'anchorSepArcsec' | 'anchorPaDeg'> & GaiaFields & HipFields & {
  anchorOffset: Stage6Offset;
};

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

/** Gaia sources a secondary row carries as its own: not its pair primary's, which a blended photocentre shares. */
export function companionOwnGaiaSources(rows: readonly MultiplesTsvRow[]): ReadonlySet<string> {
  const primaryGaia = new Map<string, string | null>();
  for (const row of rows) if (row.orbitRole === 'primary') primaryGaia.set(row.systemId, row.gaiaSourceId);
  const own = new Set<string>();
  for (const row of rows) {
    if (row.orbitRole === 'secondary' && row.gaiaSourceId !== null
        && row.gaiaSourceId !== primaryGaia.get(row.systemId)) own.add(row.gaiaSourceId);
  }
  return own;
}

export function readMultiplesTsv(): MultiplesTsvRow[] {
  return readArtifact(MULTIPLES_TSV).map(promotionRow);
}
