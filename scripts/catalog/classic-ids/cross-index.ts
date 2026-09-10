// The IV/27A cross index as every consumer reads it — the frozen CDS table
// with data/classic-ids/cross_index_corrections.tsv applied.
// See README.md § One designation, two HD numbers.
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import {
  CROSS_INDEX_CORRECTIONS_FILE,
  applyCrossIndexCorrections,
  parseCrossIndexCorrectionsTsv,
  parseCrossIndexTsv,
  type CrossIndexRow,
} from './classic-ids-parse';

export const SRC_CROSS_INDEX = resolve(ROOT, 'data/classic-ids/cross_index.tsv');
export const SRC_CROSS_INDEX_CORRECTIONS = resolve(ROOT, CROSS_INDEX_CORRECTIONS_FILE);

/** Both files, for a consumer's mtime invalidation. */
export const CROSS_INDEX_INPUT_PATHS: readonly string[] = [
  SRC_CROSS_INDEX, SRC_CROSS_INDEX_CORRECTIONS,
];

const CDS_HINT = 'refresh the CDS inputs with `pnpm run refresh:classic-ids`.';
const CURATED_HINT = 'restore it from git — it is hand-curated, not generated.';

export function readCrossIndexTable(): CrossIndexRow[] {
  return applyCrossIndexCorrections(
    parseCrossIndexTsv(readRequired(SRC_CROSS_INDEX, CDS_HINT)),
    parseCrossIndexCorrectionsTsv(
      readRequired(SRC_CROSS_INDEX_CORRECTIONS, CURATED_HINT),
    ),
  );
}
