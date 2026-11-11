// The WDS summary and the Sixth Orbit Catalog, declared.

import { defineSource } from '../util/sources/source';
import { parseOrb6, parseWdsSumm } from './wds-pure';

const HINT = 'It is frozen; restore it from git (data/wds/README.md).';

export const WDS_SUMM = defineSource({
  file: 'data/wds/wds_summ.txt',
  hint: HINT,
  parse: (input) => parseWdsSumm(input.text(), input),
});

export const ORB6 = defineSource({
  file: 'data/wds/orb6_orbits.txt',
  hint: HINT,
  parse: (input) => parseOrb6(input.text(), input),
});
