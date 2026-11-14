// Codec for data/membership/merge-divergence.tsv. See merge-derivation/README.md#the-divergence-ledger.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { recordKeyCells, rowRecordIdentifiers } from '../lineage/identity/identity-pure';
import {
  MERGE_DIVERGENCE_COLUMNS, MERGE_DIVERGENCE_KINDS, type MergeDivergenceRow,
} from './ledger-rows-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';

export const MERGE_DIVERGENCE = defineArtifact({
  file: DATA_FILES.mergeDivergence,
  columns: MERGE_DIVERGENCE_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): MergeDivergenceRow => ({
    ...rowRecordIdentifiers(row),
    divergence: row.oneOf('divergence', MERGE_DIVERGENCE_KINDS),
    cells: row.requiredText('cells'),
    derived: row.requiredText('derived'),
    evidence: row.requiredText('evidence'),
  }),
  encode: (r) => ({
    ...recordKeyCells(r), divergence: r.divergence, cells: r.cells, derived: r.derived, evidence: r.evidence,
  }),
});
