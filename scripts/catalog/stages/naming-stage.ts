// Walked to named: each record's designation constellation, the naming
// authority's tiers, and system distance coherence. See README.md#the-phases.

import { COHERENCE_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import type { FileHashes } from '../../util/build-stamp';
import {
  applyDesignationConstellations, loadDesignationConstellationIndex,
} from '../classic-ids/apply-designation-constellation';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import {
  COHERENCE_CODES, COHERENCE_LINEAGE_BUDGET, coherenceLineageLines, coherenceSummary,
} from '../multiplicity/coherence-lineage-pure';
import { applySystemCoherence, systemCoherenceVerdicts, type SystemVerdict } from '../multiplicity/system-coherence';
import { applyStarNames, loadStarNamingInputs, starNamingSummary } from '../naming/apply-star-names';
import { CONSTELLATIONS } from '../parse/constellations/constellations';
import type { ReadStarsInputs } from '../parse/read-stars-inputs';
import type { Star } from '../parse/stars-parse';
import { enterPhase, type Records } from '../record/record-phase';
import { catalogCountedStageLineage } from './catalog-stage-lineage';

export type NamingStage = ReturnType<typeof namingStage>;

export function namingStage(
  walked: Records<'walked'>,
  multiplesRows: readonly MultiplesTsvRow[],
  inputs: ReadStarsInputs,
  stepInputs: FileHashes,
) {
  console.log('Resolving designation constellations from IV/27A...');
  applyDesignationConstellations(walked, loadDesignationConstellationIndex());
  console.log('Applying the IAU WGSN naming ladder...');
  const starNamingCounts = applyStarNames(walked, loadStarNamingInputs(), CONSTELLATIONS);
  console.log(starNamingSummary(starNamingCounts));

  const coherenceVerdicts = systemCoherenceVerdicts(multiplesRows, walked, {
    gaiaAstrometry: inputs.directions.gaiaAstrometry,
    hip2: inputs.directions.hip2,
    bailerJones: inputs.bailerJones,
  });
  const coherenceEmission = coherenceLineage(coherenceVerdicts, walked, stepInputs);
  applySystemCoherence(walked, coherenceVerdicts);
  console.log(coherenceSummary(coherenceEmission.counts));
  return { named: enterPhase('named', walked), starNamingCounts, coherenceVerdicts, coherenceEmission };
}

// A function of its own so its line per record is unreachable once it returns:
// held by the caller, the lines outlive promotion and raise the build's peak heap.
function coherenceLineage(verdicts: readonly SystemVerdict[], stars: readonly Star[], stepInputs: FileHashes) {
  return catalogCountedStageLineage({
    spec: COHERENCE_LINEAGE, codes: COHERENCE_CODES, lines: () => coherenceLineageLines(verdicts, stars),
    budget: COHERENCE_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
  });
}

