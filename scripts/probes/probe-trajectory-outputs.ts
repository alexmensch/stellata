// Every file fetch:probes writes, one per roster probe, as its emitArtifacts declaration. See README.md.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { PROBE_MISSIONS } from './probe-roster';
import { probeTrajectoryFilename } from './sync-probes-pure';

export const PROBE_OUTPUTS = declareOutputs(Object.fromEntries(
  PROBE_MISSIONS.map((p) => [p.id, resolve(REPO_ROOT, 'data/probes', probeTrajectoryFilename(p.id))]),
));
