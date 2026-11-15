// Gliese & Jahreiss 1991 (V/70A), declared.

import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../util/sources/source';
import { parseGlieseTsv, type GlieseIndex } from './gliese-parse-pure';

export const GLIESE = defineSource({
  file: DATA_FILES.gliese,
  hint: 'Re-run `pnpm run refresh:gliese`.',
  rowKey: { id: 'v70a', cardinality: 'one', text: (key: string) => key },
  parse: (input): GlieseIndex => parseGlieseTsv(input.text(), GLIESE),
});
