// The Hipparcos HIP↔CCDM cross-reference (an I/239 slice), declared.

import { defineSource } from '../../util/sources/source';
import { parseHipCcdm } from './visual-doubles';

export const HIP_CCDM = defineSource({
  file: 'data/hipparcos/hip_ccdm.tsv',
  hint: 'Re-fetch from VizieR with -out=HIP,CCDM,MultFlag.',
  parse: (input) => parseHipCcdm(input.text(), input),
});
