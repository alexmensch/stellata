// The Hipparcos HIP↔CCDM cross-reference (an I/239 slice), declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseHipCcdm } from './visual-doubles';

const FROM: Declared = {
  file: 'data/hipparcos/hip_ccdm.tsv',
  hint: 'Re-fetch from VizieR with -out=HIP,CCDM,MultFlag.',
};

export const HIP_CCDM = defineSource({
  ...FROM,
  parse: (input) => parseHipCcdm(input.text(), FROM),
});
