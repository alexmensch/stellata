// Sorted to finalised: every record's display name, composed once the SIDs the
// curated overrides key on are allocated. See README.md#the-phases.

import { NAMING_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import type { FileHashes } from '../../util/build-stamp';
import type { ComponentDesignation } from '../companions/record-index/record-index';
import { assignDisplayNames, type NamedRecord } from '../naming/display-names';
import { NAME_OVERRIDES } from '../naming/name-overrides-source';
import {
  NAMING_CODES, NAMING_INVARIANTS, NAMING_LINEAGE_BUDGET, namingLineageLines,
} from '../naming/naming-lineage-pure';
import { CONSTELLATIONS } from '../parse/constellations/constellations';
import { finalise, type Sorted } from '../record/record-phase';
import type { Star } from '../parse/stars-parse';
import type { AllocatedCatalog } from './allocation-stage';
import { catalogCountedStageLineage } from './catalog-stage-lineage';

export type FinaliseStage = ReturnType<typeof finaliseStage>;

export function finaliseStage(
  sorted: Sorted<Star>,
  allocated: AllocatedCatalog,
  componentDesignations: Map<number, ComponentDesignation>,
  stepInputs: FileHashes,
) {
  const display = assignDisplayNames(
    sorted, componentDesignations, CONSTELLATIONS, NAME_OVERRIDES.read(), allocated.recordSids,
  );
  return {
    finalised: finalise(sorted, allocated.recordSids, display.displayNames),
    displayCounts: display.counts,
    namingEmission: namingLineage(display.records, sorted, stepInputs),
  };
}

// A function of its own so its lines are unreachable once it returns, as coherence's are.
function namingLineage(records: readonly NamedRecord[], stars: Sorted, stepInputs: FileHashes) {
  return catalogCountedStageLineage({
    spec: NAMING_LINEAGE, codes: NAMING_CODES, lines: () => namingLineageLines(records, stars, CONSTELLATIONS),
    budget: NAMING_LINEAGE_BUDGET, invariants: NAMING_INVARIANTS, inputs: stepInputs,
  });
}
