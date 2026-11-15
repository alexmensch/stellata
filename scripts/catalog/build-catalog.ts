// build:catalog's wiring: each stage in phase order, then the one emission
// of CATALOG_OUTPUTS. See README.md and stages/README.md.

import type { FileHashes } from '../util/build-stamp';
import { emitArtifacts } from '../util/emit-artifacts';
import { syntheticGaiaBridges } from '../sid/sid-pure';
import { loadStoredEdges } from '../sid/stored-edges';
import { parkedRefusals } from './companions/identity/parked-refusals';
import { readMultiplesTsv } from './companions/multiples-row';
import { avSolToStar } from './distance/dust/dust-deextinction-pure';
import { loadReadStarsInputs } from './parse/read-stars-inputs';
import { sortByApparentV } from './record/record-order-pure';
import { allocationStage } from './stages/allocation-stage';
import { catalogEmission, startCatalogBuild, type PreAllocation } from './stages/catalog-emission';
import { finaliseStage } from './stages/finalise-stage';
import { namingStage } from './stages/naming-stage';
import { promotionStage } from './stages/promotion-stage';
import { sortedPasses } from './stages/sorted-stage';
import { walkStage } from './stages/walk-stage';

export async function main() {
  const inputHashes = startCatalogBuild();
  const built = await preAllocationStages(inputHashes);
  const allocated = allocationStage(built.sorted, {
    placementRemovals: built.walk.placementRemovals,
    promotion: built.promotion.lines,
    promotionIdentity: built.promotion.identity,
  }, built.multiplesRows, inputHashes);
  const final = finaliseStage(built.sorted, allocated, built.passes.componentDesignations, inputHashes);
  emitArtifacts(catalogEmission(built, allocated, final, inputHashes));
}

// A function of its own so the reference tables are unreachable once it returns:
// held through SID allocation, encoding and emission, the build runs out of heap.
async function preAllocationStages(inputHashes: FileHashes): Promise<PreAllocation> {
  const inputs = await loadReadStarsInputs();
  const { walked, ...walk } = walkStage(inputs, inputHashes);
  const multiplesRows = readMultiplesTsv();
  const synthGaiaBridges = syntheticGaiaBridges(loadStoredEdges());
  const { named, ...naming } = namingStage(walked, multiplesRows, inputs, inputHashes);
  const { promoted, ...promotion } = promotionStage(named, multiplesRows, {
    conAssignment: inputs.conAssignment,
    dustGrid: inputs.dustGrid,
    parked: parkedRefusals(walk.stats.parked),
    gaiaAstrometry: inputs.directions.gaiaAstrometry,
    synthGaiaBridges,
  }, walk.manifestFounded, naming.coherenceVerdicts);
  const { sorted, sortedKey } = sortByApparentV(promoted, (s) => avSolToStar(inputs.dustGrid, s.x, s.y, s.z));
  const passes = sortedPasses(sorted, {
    multiplesRows, synthGaiaBridges, simbadSpectral: inputs.simbadSpectral, anchorMoved: promotion.anchorMoved,
    stepInputs: inputHashes,
  });
  return {
    walk, naming, promotion, sorted, sortedKey, passes, multiplesRows,
    apsisMap: inputs.apsisMap,
    gspcMap: inputs.gspcMap,
    conLookup: inputs.conAssignment.lookup,
    inputsCounts: inputs.counts,
  };
}
