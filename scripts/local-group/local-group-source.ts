// build:local-group's three inputs, declared.

import { defineSource } from '../util/sources/source';
import { parseAliases, parseLvdb, parseOverrides } from './local-group-parse';

export const LVDB = defineSource({ file: 'data/local-group/lvdb-snapshot.csv',
  hint: 'Refresh it by hand from LVDB (/scripts/local-group/README.md#inputs-and-output).', parse: (input) => parseLvdb(input.text()) });

export const LG_OVERRIDES = defineSource({
  file: 'data/local-group/overrides.tsv',
  hint: 'It is hand-curated; see /data/local-group/README.md#override-schema.',
  parse: (input) => parseOverrides(input.text(), input),
});

export const LG_ALIASES = defineSource({
  file: 'data/local-group/aliases.tsv',
  hint: 'It is hand-curated; see data/local-group/README.md.',
  parse: (input) => parseAliases(input.text(), input),
});
