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
import { sortByApparentV } from './record-order-pure';
import { allocatedSids, enterPhase, finalise } from './record-phase';

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
    const sids = allocatedSids([1]);
    const xref = { byHip: new Map(), byHd: new Map(), byGaia: new Map() };
    // Each refused call beside the same call in its own phase, which must
    // compile, so a refusal can only come from the tag.
    const refusedBesideInPlace = [
      [
        // @ts-expect-error promotion reads bayerComponent, so it takes named records
        () => promoteCompanions(rows, walked, promotionInputs),
        () => promoteCompanions(rows, named, promotionInputs),
      ],
      [
        // @ts-expect-error naming runs before promotion
        () => applyStarNames(promoted, namingInputs, []),
        () => applyStarNames(walked, namingInputs, []),
      ],
      [
        // @ts-expect-error coherence runs before promotion
        () => applySystemCoherence(named, verdicts),
        () => applySystemCoherence(walked, verdicts),
      ],
      [
        // @ts-expect-error the sort takes promoted records
        () => sortByApparentV(named, () => 0),
        () => sortByApparentV(promoted, () => 0),
      ],
      [
        // @ts-expect-error HIP → index is keyed on the sorted order
        () => buildHipToIndex(promoted),
        () => buildHipToIndex(sorted),
      ],
      [
        // @ts-expect-error geometric pairs are record indices
        () => inferBinaries(promoted),
        () => inferBinaries(sorted),
      ],
      [
        // @ts-expect-error the row-index map follows the sort
        () => buildCatalogRowIndexMap(promoted),
        () => buildCatalogRowIndexMap(sorted),
      ],
      [
        // @ts-expect-error the wings follow the sort; the map precedes them only through the resolved pairs they take
        () => wingRenderablePrimaries(pairs, promoted),
        () => wingRenderablePrimaries(pairs, sorted),
      ],
      [
        // @ts-expect-error designation constellations precede variability
        () => applyDesignationConstellations(sorted, conIndex),
        () => applyDesignationConstellations(walked, conIndex),
      ],
      [
        // @ts-expect-error variability fills desigCon only where IV/27A left it empty
        () => applyVariability(walked, new Map(), xref),
        () => applyVariability(sorted, new Map(), xref),
      ],
      [
        // @ts-expect-error display names take the sorted records
        () => assignDisplayNames(promoted, new Map(), [], new Map(), sids),
        () => assignDisplayNames(sorted, new Map(), [], new Map(), sids),
      ],
      [
        // @ts-expect-error display names key on the SIDs allocation assigned
        () => assignDisplayNames(sorted, new Map(), [], new Map(), [1]),
        () => assignDisplayNames(sorted, new Map(), [], new Map(), sids),
      ],
    ];
    expect(refusedBesideInPlace).toHaveLength(12);
  });

  it('finalises only when the SIDs and display names pair one-for-one with the records', () => {
    const sorted = enterPhase('sorted', [makeStar(), makeStar()]);
    expect(finalise(sorted, allocatedSids([1, 2]), ['Vega', null]).displayNames).toEqual(['Vega', null]);
    expect(() => finalise(sorted, allocatedSids([1]), ['Vega', null])).toThrow('2 records but 1 SIDs and 2 display names');
    expect(() => finalise(sorted, allocatedSids([1, 2]), ['Vega'])).toThrow('2 records but 2 SIDs and 1 display names');
  });
});
