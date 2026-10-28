// build:local-group's three inputs, declared.

import { defineSource, type Declared } from '../util/sources/source';
import { parseAliases, parseLvdb, parseOverrides } from './local-group-parse';

const LVDB_FROM: Declared = {
  file: 'data/local-group/lvdb-snapshot.csv',
  hint: 'Refresh it by hand from LVDB (/scripts/local-group/README.md#inputs-and-output).',
};
const OVERRIDES_FROM: Declared = {
  file: 'data/local-group/overrides.tsv',
  hint: 'It is hand-curated; see /data/local-group/README.md#override-schema.',
};
const ALIASES_FROM: Declared = {
  file: 'data/local-group/aliases.tsv',
  hint: 'It is hand-curated; see data/local-group/README.md.',
};

export const LVDB = defineSource({ ...LVDB_FROM, parse: (input) => parseLvdb(input.text()) });

export const LG_OVERRIDES = defineSource({
  ...OVERRIDES_FROM,
  parse: (input) => parseOverrides(input.text(), OVERRIDES_FROM),
});

export const LG_ALIASES = defineSource({
  ...ALIASES_FROM,
  parse: (input) => parseAliases(input.text(), ALIASES_FROM),
});
