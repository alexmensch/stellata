// Every file build:classic-ids writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';

export const CLASSIC_ID_OUTPUTS = declareOutputs({
  overlay: resolve(REPO_ROOT, 'data/classic-ids/classic_id_overlay.tsv'),
  disagreements: resolve(REPO_ROOT, 'data/classic-ids/hd_hip_route_disagreements.tsv'),
  rejected: resolve(REPO_ROOT, 'data/classic-ids/rejected_bindings.tsv'),
});
