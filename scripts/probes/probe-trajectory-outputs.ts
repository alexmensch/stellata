// Every file fetch:probes writes, one per roster probe, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { PROBE_MISSIONS } from '../../src/catalog-format/probes/probe-roster';
import { rosterFileName } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const PROBE_OUTPUTS = declareOutputs(Object.fromEntries(
  PROBE_MISSIONS.map((p) => [p.id, `data/probes/${rosterFileName(p.id)}`]),
));
