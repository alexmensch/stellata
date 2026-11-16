// The manifest walk: the walked records, with placement's, brightness-colour's
// and size's lineage and the two ledgers the walk decides. See README.md.

import {
  BRIGHTNESS_COLOUR_LINEAGE, PLACEMENT_LINEAGE, SIZE_LINEAGE,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import type { FileHashes } from '../../util/build-stamp';
import { artifactRows } from '../../util/sources/source';
import { PARKED_LEDGER } from '../distance/parallax/parked-ledger-tsv';
import { SIMBAD_SOURCED_DISTANCES } from '../distance/parallax/simbad-sourced-ledger-tsv';
import { placementSummary } from '../distance/placement-counts-pure';
import {
  PLACEMENT_CODES, PLACEMENT_INVARIANTS, PLACEMENT_LINEAGE_BUDGET, parkedLedgerView, placementLineageLines,
} from '../distance/placement-lineage-pure';
import { LineSpill } from '../lineage/storage/line-spill';
import { lineageLineCode, type LineageLine } from '../lineage/lineage-row-pure';
import { codeEffects } from '../lineage/reason-codes/reason-codes-pure';
import { MEMBERSHIP_MANIFEST, manifestDesignations } from '../membership/membership-manifest-tsv';
import type { ReadStarsInputs } from '../parse/read-stars-inputs';
import { readStars, type WalkedStar } from '../parse/stars-parse';
import { walkVelocitySummary } from '../parse/walk-stats-pure';
import {
  BRIGHTNESS_COLOUR_CODES, BRIGHTNESS_COLOUR_LINEAGE_BUDGET, brightnessColourLineageLines, brightnessColourSummary,
} from '../photometry/brightness-colour-lineage-pure';
import { enterPhase } from '../record/record-phase';
import { SIZE_CODES, SIZE_LINEAGE_BUDGET, sizeLineageLines } from '../spectral/size-lineage-pure';
import { catalogCountedStageLineage, catalogStageLineage } from './catalog-stage-lineage';

const PLACEMENT_EFFECTS = codeEffects([PLACEMENT_CODES]);

export type WalkStage = ReturnType<typeof walkStage>;

export function walkStage(inputs: ReadStarsInputs, stepInputs: FileHashes) {
  console.log(`Reading ${MEMBERSHIP_MANIFEST.file}...`);
  const t0 = Date.now();
  const { stars, ...walk } = walkManifest(inputs, stepInputs);
  console.log(`  parsed ${walk.stats.total} rows in ${Date.now() - t0}ms`);
  console.log(`  kept ${stars.length} stars; parked ${walk.stats.parked.length}`);
  console.log(placementSummary(walk.placementEmission.counts, walk.stats.placementDerived));
  console.log(brightnessColourSummary(walk.brightnessEmission.counts));
  console.log(walkVelocitySummary(walk.stats));
  return { ...walk, walked: enterPhase('walked', stars), simbadSourcedDistances: simbadSourcedDistancesTsv(stars) };
}

// A function of its own so the walk's lines are unreachable once it returns:
// held by the caller, they outlive the walk and the build runs out of heap.
function walkManifest(inputs: ReadStarsInputs, stepInputs: FileHashes) {
  let placementLines: LineageLine[] = [];
  const brightnessSpill = new LineSpill();
  try {
    const sizeSpill = new LineSpill();
    try {
      const manifestFounded = new Set<string>();
      const manifest = function* () {
        for (const r of artifactRows(MEMBERSHIP_MANIFEST)) {
          for (const d of manifestDesignations(r)) manifestFounded.add(d);
          yield r;
        }
      };
      const { stars, stats } = readStars(manifest(), inputs, (outcome) => {
        for (const line of placementLineageLines(outcome.placement)) placementLines.push(line);
        if (outcome.brightness !== null) for (const line of brightnessColourLineageLines(outcome.brightness)) brightnessSpill.push(line);
        if (outcome.kind === 'shipped') for (const line of sizeLineageLines(outcome.size)) sizeSpill.push(line);
      });
      const parkedLedger = parkedLedgerTsv(placementLines);
      const placementRemovals = placementLines.filter((line) => PLACEMENT_EFFECTS.get(lineageLineCode(line)) !== 'none');
      const placementEmission = catalogCountedStageLineage({
        spec: PLACEMENT_LINEAGE, codes: PLACEMENT_CODES, lines: () => placementLines,
        budget: PLACEMENT_LINEAGE_BUDGET, invariants: PLACEMENT_INVARIANTS, inputs: stepInputs,
      });
      // Released before brightness-colour's lines are read back, or both stages' lines are held at once.
      placementLines = [];
      const brightnessEmission = catalogCountedStageLineage({
        spec: BRIGHTNESS_COLOUR_LINEAGE, codes: BRIGHTNESS_COLOUR_CODES, lines: () => brightnessSpill.lines(),
        budget: BRIGHTNESS_COLOUR_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
      });
      const sizeEmission = catalogStageLineage({
        spec: SIZE_LINEAGE, codes: SIZE_CODES, lines: () => sizeSpill.lines(),
        budget: SIZE_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
      });
      return { stars, stats, parkedLedger, placementEmission, brightnessEmission, sizeEmission, manifestFounded, placementRemovals };
    } finally {
      sizeSpill.dispose();
    }
  } finally {
    brightnessSpill.dispose();
  }
}

function parkedLedgerTsv(placementLines: readonly LineageLine[]): string {
  const parked = parkedLedgerView(placementLines);
  console.log(`  parked (record parity): ${parked.length} → ${PARKED_LEDGER.file}`);
  return PARKED_LEDGER.serialize(parked);
}

/** Validation independence (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers), made checkable: a record whose distance came
 *  from the SIMBAD tier cannot be verified against SIMBAD's own parallax, so
 *  the sample validator needs to know which records those are. It reads
 *  catalog.bin, which carries no `distVia`, hence the file. */
function simbadSourcedDistancesTsv(stars: readonly WalkedStar[]): string {
  const rows = stars
    .filter((s) => s.distVia === 'simbad_plx')
    .map((s) => ({ gaiaSourceId: s.gaiaSourceId, hip: s.hip }));
  console.log(
    `  SIMBAD-sourced distances: ${rows.length} → ${SIMBAD_SOURCED_DISTANCES.file}`,
  );
  return SIMBAD_SOURCED_DISTANCES.serialize(rows);
}
