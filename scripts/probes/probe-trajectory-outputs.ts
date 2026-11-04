// Every file fetch:probes writes, one per roster probe, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { PROBE_MISSIONS } from '../../src/catalog-format/probes/probe-roster';
import { probeTrajectoryFilename } from '../../src/catalog-format/probes/sync-probes-pure';

export const PROBE_OUTPUTS = declareOutputs(Object.fromEntries(
  PROBE_MISSIONS.map((p) => [p.id, `data/probes/${probeTrajectoryFilename(p.id)}`]),
));
