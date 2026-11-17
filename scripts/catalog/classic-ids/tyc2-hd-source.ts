// IV/25, the Tycho-2 → HD cross-identification, with its curated corrections applied, declared. See README.md#crossed-hd-numbers-in-iv25.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource, type Declared } from '../../util/sources/source';
import { applyTyc2HdCorrections, parseTyc2HdCorrectionsTsv, parseTyc2HdTsv } from './classic-ids-parse';

const CORRECTIONS: Declared = {
  file: 'data/classic-ids/tyc2_hd_corrections.tsv',
  hint: 'Restore it from the repo — it is hand-curated, not generated.',
};

export const TYC2_HD = defineSource({
  file: DATA_FILES.tyc2Hd,
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
  members: [CORRECTIONS],
  rowKey: { id: 'iv25', cardinality: 'one', text: (tyc: string) => tyc },
  parse: (input) => {
    const [corrections] = input.members;
    return applyTyc2HdCorrections(
      parseTyc2HdTsv(input.text(), input),
      parseTyc2HdCorrectionsTsv(corrections.text(), corrections),
      corrections,
    );
  },
});
