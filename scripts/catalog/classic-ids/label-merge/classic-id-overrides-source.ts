// The curated per-identifier label overrides, declared.

import { defineSource } from '../../../util/sources/source';
import { parseLabelOverridesTsv } from './label-merge-pure';

export const CLASSIC_ID_OVERRIDES = defineSource({
  file: 'data/classic-ids/classic_id_overrides.tsv',
  hint: 'It is committed and hand-curated: columns gaia_source_id, field, value (empty value = keep the spine).',
  parse: (input) => parseLabelOverridesTsv(input.text(), input),
});
