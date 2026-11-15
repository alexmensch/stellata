// Tokovinin's Multiple Star Catalogue tables, declared.

import { defineSource } from '../../util/sources/source';
import { parseMscComponents, parseMscOrbits, parseMscSystems, type MscOrbitKey, type MscOrbitRow } from './msc-pure';

const HINT = 'Re-run `pnpm run refresh:msc`.';

export const MSC_SYSTEMS = defineSource({
  file: 'data/msc/msc_systems.tsv',
  hint: HINT,
  parse: (input) => parseMscSystems(input.text(), input),
});

export const MSC_ORBITS = defineSource({
  file: 'data/msc/msc_orbits.tsv',
  hint: HINT,
  rowKey: { id: 'msc-orbits', cardinality: 'group', text: ({ wdsId, syst }: MscOrbitKey) => `${wdsId}/${syst}` },
  parse: (input): MscOrbitRow[] => parseMscOrbits(input.text(), MSC_ORBITS),
});

export const MSC_COMPONENTS = defineSource({
  file: 'data/msc/msc_components.tsv',
  hint: HINT,
  parse: (input) => parseMscComponents(input.text(), input),
});
