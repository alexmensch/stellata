// Every file fetch:ephemerides writes, one per planet, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { ELEMENT_TARGETS } from '../../src/catalog-format/ephemerides/planet-element-roster';
import { rosterFileName } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const ELEMENT_TABLE_OUTPUTS = declareOutputs(Object.fromEntries(
  ELEMENT_TARGETS.map((t) => [t.id, `data/ephemerides/${rosterFileName(t.id)}`]),
));
