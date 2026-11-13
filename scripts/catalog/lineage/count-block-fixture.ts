// Test-only: a stage's count block checked against a snapshot before and after a code is seeded into its declarations.

import { compareCountSnapshot } from '../build-counts';
import { nestByStage } from '../../util/counts/count-stages-pure';
import { foldStageLines, type LineageLine } from './lineage-row-pure';
import { outcomeCode, stageCodes, type StageCodes } from './reason-codes/reason-codes-pure';

export const SEEDED_BRANCH = 'seeded';

/** The snapshot check a build runs once `SEEDED_BRANCH` is declared: against
 *  the snapshot committed before it (`drift`), and after the refresh (`refreshed`). */
export function seededCodeCheck(codes: StageCodes<string>, lines: readonly LineageLine[]) {
  const snapshot = (counts: Readonly<Record<string, number>>) => nestByStage(
    [codes.stage], [{ stage: codes.stage, block: { kind: 'counted', counts } }],
  );
  const committed = snapshot(foldStageLines(codes, lines));
  const seeded = stageCodes(codes.stage, { ...codes.declarations, [SEEDED_BRANCH]: outcomeCode('A new rule.') });
  const built = snapshot(foldStageLines(seeded, lines));
  return {
    drift: compareCountSnapshot<object>(committed, built),
    refreshed: compareCountSnapshot<object>(built, built),
  };
}
