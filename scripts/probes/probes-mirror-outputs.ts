// The files build:probes-sync writes into public/probes/, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { publicRepoPath } from '../util/paths';
import { PROBE_MISSIONS } from '../../src/catalog-format/probes/probe-roster';
import { PUBLIC_FOLDERS, rosterFileName } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const MIRROR_OUTPUTS = declareOutputs({}, [{
  dir: publicRepoPath(PUBLIC_FOLDERS.probes),
  member: PROBE_MISSIONS.map((p) => rosterFileName(p.id)),
  stamped: true,
}]);
