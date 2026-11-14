// Each fold's lineage and identity rows, and the check that a fold is a merge rather than a drop. See README.md#correcting-a-merge-decision.

import { spineDesignations, type SpineRow } from '../../spine/inherited-spine-pure';
import { identityRow, type IdentityRow } from '../../lineage/identity-pure';
import { bindingReviewKey } from '../ledger-rows-pure';
import type { KeyedOutcome } from '../membership-lineage-pure';
import { manifestDesignations, type ManifestRecord } from '../membership-manifest-tsv';
import { SPINE_CORRECTIONS_NAME, type SpineFold } from './spine-corrections-pure';

/** Throws unless the survivor's manifest row answers to every designation the
 *  folded row did. */
export function foldOutcomes(
  folds: readonly SpineFold[],
  corrected: readonly SpineRow[],
  survivors: readonly ManifestRecord[],
  spineKey: (spineRow: number) => string,
): { outcomes: KeyedOutcome[]; identity: IdentityRow[] } {
  const outcomes: KeyedOutcome[] = [];
  const identity: IdentityRow[] = [];
  for (const { foldedRow, survivorRow, survivorKept } of folds) {
    const folded = corrected[foldedRow];
    outcomes.push({ key: spineKey(foldedRow), outcome: { kind: 'fold', survivor: spineKey(survivorRow) } });
    identity.push(identityRow(spineKey(foldedRow), { ...folded, gaia_source_id: '' }, spineDesignations(folded)));
    const survivorHolds = new Set(manifestDesignations(survivors[survivorKept]));
    const lost = spineDesignations(folded).filter((d) => !survivorHolds.has(d));
    if (lost.length > 0) {
      throw new Error(
        `${SPINE_CORRECTIONS_NAME}: folding ${bindingReviewKey(folded)} loses `
          + `${lost.join(', ')} — the survivor does not answer to it`,
      );
    }
  }
  return { outcomes, identity };
}
