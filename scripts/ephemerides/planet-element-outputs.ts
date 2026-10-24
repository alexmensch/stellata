// Every file fetch:ephemerides writes, one per planet, as its emitArtifacts declaration. See README.md.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { ELEMENT_TARGETS } from './planet-element-roster';

export const ELEMENT_TABLE_OUTPUTS = declareOutputs(Object.fromEntries(
  ELEMENT_TARGETS.map((t) => [t.id, resolve(REPO_ROOT, 'data/ephemerides', `${t.id}.json`)]),
));
