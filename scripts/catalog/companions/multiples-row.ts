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

export function readMultiplesTsv(): MultiplesTsvRow[] {
  return readArtifact(MULTIPLES_TSV).map(promotionRow);
}
