// The binaries pipeline's three hand-curated tables, declared.

import { defineSource } from '../../util/sources/source';
import {
  parseAstrometryExclusions, parseComponentSptypeOverrides, parseOrb6ComponentOverrides,
} from './curated-pure';

const HINT = 'It is hand-curated: correct the row (data/binaries/README.md).';

export const ORB6_COMPONENT_OVERRIDES = defineSource({
  file: 'data/binaries/orb6_component_overrides.tsv',
  hint: HINT,
  parse: (input) => parseOrb6ComponentOverrides(input.text(), input),
});

export const COMPONENT_SPTYPE_OVERRIDES = defineSource({
  file: 'data/binaries/component_sptype_overrides.tsv',
  hint: HINT,
  parse: (input) => parseComponentSptypeOverrides(input.text(), input),
});

export const ASTROMETRY_EXCLUSIONS = defineSource({
  file: 'data/binaries/astrometry_exclusions.tsv',
  hint: HINT,
  parse: (input) => parseAstrometryExclusions(input.text(), input),
});
