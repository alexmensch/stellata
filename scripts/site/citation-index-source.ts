// The citation index the public pages count and cite, declared.

import { defineSource } from '../util/sources/source.ts';
import { parseIndex } from '../util/citation-index-pure.ts';

export const CITATION_INDEX = defineSource({
  file: 'data/papers/index.md',
  hint: 'It is curated by hand (/data/papers/README.md#cited-papers).',
  parse: (input) => parseIndex(input.text()),
});
