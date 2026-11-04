// Every file build:classic-ids writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../../util/emit-artifacts';

export const CLASSIC_ID_OUTPUTS = declareOutputs({
  overlay: 'data/classic-ids/classic_id_overlay.tsv',
  disagreements: 'data/classic-ids/hd_hip_route_disagreements.tsv',
  rejected: 'data/classic-ids/rejected_bindings.tsv',
});
