// The cited eponyms and the dropped names, declared.

import { defineSource } from '../../util/sources/source';
import { parseEponyms, parseNameDrops } from './string-designations-pure';

export const EPONYMS = defineSource({
  file: 'data/naming/eponyms.tsv',
  hint: 'It is hand-curated: restore the name, class, key, source, citation and ident columns.',
  parse: (input) => parseEponyms(input.text(), input),
});

export const NAME_DROPS = defineSource({
  file: 'data/naming/name_drops.tsv',
  hint: 'It is hand-curated: restore the name, class, key and evidence columns.',
  parse: (input) => parseNameDrops(input.text(), input),
});
