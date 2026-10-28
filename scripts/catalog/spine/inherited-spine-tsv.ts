// INHERITED_SPINE, the frozen spine's codec. See README.md#files-in-this-area.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { SPINE_COLUMNS, type SpineRow } from './inherited-spine-pure';

/** Frozen: its committed bytes are the record of AT-HYG's merge decisions,
 *  so the codec reads and writes the cells verbatim. A row is cited by its
 *  physical line number, not its identifier cells, which a correction can
 *  rewrite (../lineage/README.md#identity--the-origin-source-row). */
export const INHERITED_SPINE = defineArtifact({
  file: 'data/athyg/inherited-spine.tsv',
  columns: SPINE_COLUMNS,
  hint: 'It is frozen; restore it from git rather than regenerating it.',
  order: 'as-given',
  rowKey: { id: 'spine', text: (line: number) => String(line) },
  decode: (row): SpineRow => {
    row.sourceId('gaia_source_id');
    return row.cells();
  },
  encode: (row) => row,
});
