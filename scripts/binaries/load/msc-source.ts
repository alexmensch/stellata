// Tokovinin's Multiple Star Catalogue tables, declared.

import { defineSource } from '../../util/sources/source';
import { parseMscComponents, parseMscOrbits, parseMscSystems } from './msc-pure';

const HINT = 'Re-run `pnpm run refresh:msc`.';

export const MSC_SYSTEMS = defineSource({
  file: 'data/msc/msc_systems.tsv',
  hint: HINT,
  parse: (input) => parseMscSystems(input.text(), input),
});

export const MSC_ORBITS = defineSource({
  file: 'data/msc/msc_orbits.tsv',
  hint: HINT,
  parse: (input) => parseMscOrbits(input.text(), input),
});

export const MSC_COMPONENTS = defineSource({
  file: 'data/msc/msc_components.tsv',
  hint: HINT,
  parse: (input) => parseMscComponents(input.text(), input),
});
