// Tokovinin's Multiple Star Catalogue tables, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseMscComponents, parseMscOrbits, parseMscSystems, type MscOrbitKey, type MscOrbitRow } from './msc-pure';

const HINT = 'Re-run `pnpm run refresh:msc`.';

export const MSC_SYSTEMS = defineSource({
  file: DATA_FILES.mscSystems,
  hint: HINT,
  parse: (input) => parseMscSystems(input.text(), input),
});

export const MSC_ORBITS = defineSource({
  file: DATA_FILES.mscOrbits,
  hint: HINT,
  rowKey: { id: 'msc-orbits', cardinality: 'group', text: ({ wdsId, syst }: MscOrbitKey) => `${wdsId}/${syst}` },
  parse: (input): MscOrbitRow[] => parseMscOrbits(input.text(), MSC_ORBITS),
});

export const MSC_COMPONENTS = defineSource({
  file: DATA_FILES.mscComponents,
  hint: HINT,
  parse: (input) => parseMscComponents(input.text(), input),
});
