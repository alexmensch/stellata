// The frozen list of refused SIMBAD Flamsteed numbers, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseRefusals } from './flamsteed-refusals-pure';

export const FLAMSTEED_REFUSALS_LIST = defineSource({
  file: DATA_FILES.flamsteedRefusals,
  hint: 'Hand-curated: /scripts/catalog/simbad/README.md#the-refused-numbers says when a row changes.',
  parse: (input) => parseRefusals(input.text(), input),
});
