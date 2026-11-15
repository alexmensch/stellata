import { describe, expect, it } from 'vitest';

import { applyDesignationConstellations } from '../classic-ids/apply-designation-constellation';
import type { DesignationConIndex } from '../classic-ids/designation-constellation-pure';
import { promoteCompanions, type PromotionInputs } from '../companions/companion-promotion';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import type { ResolvedPair } from '../companions/record-index/pair-resolution-pure';
import { buildCatalogRowIndexMap, wingRenderablePrimaries } from '../companions/record-index/record-index';
import { buildHipToIndex, inferBinaries } from '../multiplicity/binary-flags-pure';
import { applySystemCoherence, type SystemVerdict } from '../multiplicity/system-coherence';
import { applyStarNames, type StarNamingInputs } from '../naming/apply-star-names';
import { assignDisplayNames } from '../naming/display-names';
import { applyVariability } from '../parse/gcvs/gcvs-parse';
import { makeStar } from '../parse/star-fixture';
import { finaliseStage } from '../stages/finalise-stage';
import { sortByApparentV } from './record-order-pure';
import { enterPhase } from './record-phase';

declare const rows: MultiplesTsvRow[];
declare const promotionInputs: PromotionInputs;
declare const verdicts: readonly SystemVerdict[];
declare const pairs: readonly ResolvedPair[];
declare const conIndex: DesignationConIndex;
declare const namingInputs: StarNamingInputs;

describe('record phases', () => {
  it('refuses each constrained pass moved out of its phase, at compile time', () => {
    const walked = enterPhase('walked', [makeStar()]);
    const named = enterPhase('named', [makeStar()]);
    const promoted = enterPhase('promoted', [makeStar()]);
    const sorted = enterPhase('sorted', [makeStar()]);
    const reorderings = [
      // @ts-expect-error promotion reads bayerComponent, so it takes named records
      () => promoteCompanions(rows, walked, promotionInputs),
      // @ts-expect-error naming runs before promotion
      () => applyStarNames(promoted, namingInputs, []),
      // @ts-expect-error coherence runs before promotion
      () => applySystemCoherence(named, verdicts),
      // @ts-expect-error the sort takes promoted records
      () => sortByApparentV(named, () => 0),
      // @ts-expect-error HIP → index is keyed on the sorted order
      () => buildHipToIndex(promoted),
      // @ts-expect-error geometric pairs are record indices
      () => inferBinaries(promoted),
      // @ts-expect-error the row-index map follows the sort
      () => buildCatalogRowIndexMap(promoted),
      // @ts-expect-error the wings follow the sort and the row-index map
      () => wingRenderablePrimaries(pairs, promoted),
      // @ts-expect-error designation constellations precede variability
      () => applyDesignationConstellations(sorted, conIndex),
      // @ts-expect-error variability fills desigCon only where IV/27A left it empty
      () => applyVariability(walked, new Map(), { byHip: new Map(), byHd: new Map(), byGaia: new Map() }),
      // @ts-expect-error display names take the sorted records
      () => assignDisplayNames(promoted, new Map(), [], new Map(), []),
      // @ts-expect-error display names key on the allocation's SIDs
      () => finaliseStage(sorted, { recordSids: [] }, new Map(), {}),
    ];
    expect(reorderings).toHaveLength(12);
  });
});
