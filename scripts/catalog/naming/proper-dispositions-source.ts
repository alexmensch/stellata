// The curated disposition of every AT-HYG proper name the WGSN authority does not approve, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseProperDispositions } from './wgsn-index-pure';

const FROM: Declared = {
  file: 'data/iau-wgsn/athyg_proper_dispositions.tsv',
  hint: 'It is hand-curated: restore the proper, class, hip and hd columns.',
};

export const PROPER_DISPOSITIONS = defineSource({
  ...FROM,
  parse: (input) => parseProperDispositions(input.text(), FROM),
});
