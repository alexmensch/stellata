// The curated per-identifier label overrides, declared.

import { defineSource, type Declared } from '../../../util/sources/source';
import { parseLabelOverridesTsv } from './label-merge-pure';

const FROM: Declared = {
  file: 'data/classic-ids/classic_id_overrides.tsv',
  hint: 'It is committed and hand-curated: columns gaia_source_id, field, value (empty value = keep the spine).',
};

export const CLASSIC_ID_OVERRIDES = defineSource({
  ...FROM,
  parse: (input) => parseLabelOverridesTsv(input.text(), FROM),
});
