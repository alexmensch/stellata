// The files build:ephemerides-sync writes into public/ephemerides/, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { publicRepoPath } from '../util/paths';
import { ELEMENT_TARGETS } from '../../src/catalog-format/ephemerides/planet-element-roster';
import { PUBLIC_FOLDERS, rosterFileName } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const MIRROR_OUTPUTS = declareOutputs({}, [{
  dir: publicRepoPath(PUBLIC_FOLDERS.ephemerides),
  member: ELEMENT_TARGETS.map((t) => rosterFileName(t.id)),
  stamped: true,
}]);
