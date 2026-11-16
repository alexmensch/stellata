// Named to promoted: multiples.tsv secondaries minted as records, with
// promotion's lineage lines and identity. See README.md#the-phases.

import { promoteCompanions, type PromotionInputs } from '../companions/companion-promotion';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import { recuratedRecords } from '../companions/promotion-outcome';
import {
  PROMOTION_CODES, promotionLineage, promotionSummary,
} from '../companions/promotion-lineage/promotion-lineage-pure';
import { foldStageLines, stageLines } from '../lineage/lineage-row-pure';
import type { SystemVerdict } from '../multiplicity/system-coherence';
import { enterPhase, type Records } from '../record/record-phase';
import { anchorMovedRecords } from '../system-membership/system-membership-pure';

export type PromotionStage = ReturnType<typeof promotionStage>;

// A function of its own so promotion's rows and rewrites are unreachable once
// it returns, as coherence's lines are.
export function promotionStage(
  named: Records<'named'>,
  multiplesRows: MultiplesTsvRow[],
  inputs: PromotionInputs,
  founded: ReadonlySet<string>,
  coherenceVerdicts: readonly SystemVerdict[],
) {
  console.log('Promoting binary companions from multiples.tsv...');
  const t0 = Date.now();
  const { newStars, stats, rows, rewrites } = promoteCompanions(multiplesRows, named, inputs);
  const promoted = enterPhase('promoted', [...named, ...newStars]);
  const { lineage, identity } = promotionLineage(rows, promoted, founded, rewrites);
  const lines = stageLines(PROMOTION_CODES, lineage);
  const counts = foldStageLines(PROMOTION_CODES, lines);
  console.log(`  promotion decided ${rows.length} rows in ${Date.now() - t0}ms`);
  console.log(promotionSummary(counts, stats, rows.filter((r) => r.via === 'secondary').length));
  return {
    promoted, stats, lines, identity, counts,
    anchorMoved: anchorMovedRecords(promoted, coherenceVerdicts, recuratedRecords(rewrites)),
  };
}
