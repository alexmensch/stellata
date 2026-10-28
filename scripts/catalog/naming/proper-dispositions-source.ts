// The curated disposition of every AT-HYG proper name the WGSN authority does not approve, declared.

import { defineSource } from '../../util/sources/source';
import { parseProperDispositions } from './wgsn-index-pure';

export const PROPER_DISPOSITIONS = defineSource({
  file: 'data/iau-wgsn/athyg_proper_dispositions.tsv',
  hint: 'It is hand-curated: restore the proper, class, hip and hd columns.',
  parse: (input) => parseProperDispositions(input.text(), input),
});
