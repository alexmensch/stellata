// The curated sources the label merge treats as having a sibling component SIMBAD's WDS cross-IDs do not name, declared.

import { defineSource } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

export interface SiblingRenderedRow {
  readonly sourceId: string;
  readonly wdsId: string;
}

export const SIBLING_RENDERED = defineSource({
  file: 'data/membership/sibling-rendered.tsv',
  hint: 'It is committed and hand-curated (../classic-ids/label-merge/README.md#an-alias-stops-at-the-blend).',
  parse: (input): SiblingRenderedRow[] => [...readTable(
    { file: input.file, hint: input.hint, columns: ['gaia_source_id', 'wds_id'] }, input.text(),
  )].map((row) => ({ sourceId: row.requiredSourceId('gaia_source_id'), wdsId: row.text('wds_id') ?? row.fail('wds_id is empty') })),
});
