// The WDS summary and the Sixth Orbit Catalog, declared.

import { defineSource } from '../util/sources/source';
import { parseOrb6, parseWdsSumm, wdsPairRowKey, type Orb6Parse, type WdsPair } from './wds-pure';

const HINT = 'It is frozen; restore it from git (data/wds/README.md).';

export const WDS_SUMM = defineSource({
  file: 'data/wds/wds_summ.txt',
  hint: HINT,
  rowKey: wdsPairRowKey('wds'),
  parse: (input): WdsPair[] => parseWdsSumm(input.text(), WDS_SUMM),
});

/** Keyed by the components Stage 1 reads, curated letters stamped (`data/binaries/orb6_component_overrides.tsv`). */
export const ORB6 = defineSource({
  file: 'data/wds/orb6_orbits.txt',
  hint: HINT,
  rowKey: wdsPairRowKey('orb6'),
  parse: (input): Orb6Parse => parseOrb6(input.text(), input),
});
