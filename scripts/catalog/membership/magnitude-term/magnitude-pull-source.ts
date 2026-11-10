// The Gaia DR3 magnitude pull, declared; streamed, since it runs to ~200 MB.

import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../../util/sources/source';
import { MAGNITUDE_PULL_HINT } from './magnitude-term-pure';

export const MAGNITUDE_PULL = defineSource({
  file: DATA_FILES.gaiaMagnitudePull,
  hint: MAGNITUDE_PULL_HINT,
  rowKey: { id: 'gaia-dr3', text: (sourceId: string) => sourceId },
  parse: (input, onLine: (line: string) => void) => input.lines(onLine),
});
