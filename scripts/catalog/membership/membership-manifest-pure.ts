// buildMembership: the membership phases wired in order — corrections, spine bindings, spine side, folds, additions, magnitude term. Contract: /docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries.

import type { ClassicIdOverlay } from '../classic-ids/classic-id-overlay-pure';
import type { LabelMergeCounts, LabelOverrides } from '../classic-ids/label-merge/label-merge-pure';
import { fold, prefixed } from '../../util/counts/tally-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import { identityRow } from '../lineage/identity-pure';
import type { LineageRow } from '../lineage/lineage-row-pure';
import type { SpineRow } from '../spine/inherited-spine-pure';
import { indexPrimaries, type PrimaryTables } from '../spine/primaries-audit-pure';
import { admitAdditions } from './additions/admission-pure';
import type { BindingEvidence } from './binding/binding-gate-pure';
import { ownCandidates, rowDeriver } from './binding/binding-outcomes-pure';
import { settleSpineBindings } from './binding/spine-settle-pure';
import type { BindingDispositionRow } from './binding-review-dispositions-pure';
import { magnitudeTermRows } from './magnitude-term/magnitude-rows-pure';
import type { MagnitudeTermSelection } from './magnitude-term/magnitude-term-pure';
import {
  membershipLedgers,
  membershipLineageRow,
  type MembershipDerivedCounts,
  type MembershipLedgers,
  type OriginKeys,
} from './membership-lineage-pure';
import {
  MEMBERSHIP_MANIFEST,
  manifestDesignations,
  sortManifestRecords,
  type ManifestRecord,
} from './membership-manifest-tsv';
import { spineSide } from './spine-side-pure';
import { foldOutcomes } from './spine-corrections/fold-check-pure';
import {
  applySpineCorrections, SPINE_CORRECTION_CELLS, type SpineCorrectionRow,
} from './spine-corrections/spine-corrections-pure';

export const MEMBERSHIP_EXPECTED_FILE =
  'scripts/catalog/membership/membership-manifest-expected.json';

/** The snapshot's stages in pipeline order; each has a `-derived` slot beside it. */
export const MEMBERSHIP_COUNT_STAGES = ['magnitude-term', 'membership'] as const;

export interface MembershipInput {
  spine: readonly SpineRow[];
  tables: PrimaryTables;
  /** The committed post-gate overlay the spine side's label merge reads:
   *  `has(source)` is the HD-route gate's verdict (/docs/catalog-driver.md#4-how-hd-reaches-gaia). */
  overlay: ClassicIdOverlay;
  overrides: LabelOverrides;
  siblingRenderedSourceIds: ReadonlySet<string>;
  /** The binding gates' evidence — G per source, printed V per HIP, WDS
   *  component cross-IDs — for the derivation's candidates. */
  evidence: BindingEvidence;
  /** The committed dispositions of the binding review queue, by
   *  `bindingReviewKey`. */
  dispositions: ReadonlyMap<string, BindingDispositionRow>;
  /** The committed corrections to AT-HYG's merge decisions
   *  (spine-corrections/README.md). */
  corrections: readonly SpineCorrectionRow[];
  /** `magnitude-term/README.md#the-union-dedupes-on-the-derived-binding`. */
  magnitudeTerm: MagnitudeTermSelection | null;
  /** Whether the pulled astrometry gives this source a parallax — what decides
   *  which of two groups contesting a designation ships (additions/README.md). */
  publishesGaiaParallax: (sourceId: string) => boolean;
  keys: OriginKeys;
}

export interface MembershipResult extends MembershipLedgers {
  rows: ManifestRecord[];
  lineage: LineageRow[];
  identity: IdentityRow[];
  derived: MembershipDerivedCounts;
}

export function buildMembership(input: MembershipInput): MembershipResult {
  const { tables, evidence, keys, corrections } = input;
  const idx = indexPrimaries(tables);
  const { corrected, kept, keptSpineIndex, folds } = applySpineCorrections(input.spine, corrections);
  const keyOf = (keptRow: number): string => keys.spine(keptSpineIndex[keptRow]);
  const derive = rowDeriver(tables, idx, evidence);

  const settlement = settleSpineBindings({
    kept, keyOf, derive, dispositions: input.dispositions, evidence, tables,
  });
  const spine = spineSide({
    kept, keyOf, settled: settlement.rows, overlay: input.overlay, overrides: input.overrides,
    siblingRenderedSourceIds: input.siblingRenderedSourceIds, tables, idx,
  });
  const folded = foldOutcomes(folds, corrected, spine.rows, keys.spine);
  const additions = admitAdditions({
    tables, idx, kept, spineRecords: spine.records, derive, keys,
    publishesGaiaParallax: input.publishesGaiaParallax,
  });
  const primariesRows = [...spine.rows, ...additions.rows];
  const magnitude = magnitudeTermRows(
    input.magnitudeTerm, primariesRows,
    ownCandidates([...settlement.unshipped, ...additions.unshipped]), keys.gaia,
  );

  const rows = [...primariesRows, ...magnitude.rows];
  const identity = [
    ...folded.identity,
    ...additions.identity,
    ...rows.map((r) => identityRow(r.originKey, MEMBERSHIP_MANIFEST.encode(r), manifestDesignations(r))),
  ];
  const lineage = [
    ...settlement.outcomes, ...spine.outcomes, ...folded.outcomes, ...additions.outcomes, ...magnitude.outcomes,
  ].map(membershipLineageRow);
  const ledgers = membershipLedgers(lineage, new Map(identity.map((r) => [r.key, r])));
  const sorted = sortManifestRecords(rows);
  return {
    rows: sorted, ...ledgers, lineage, identity,
    derived: derivedCounts(sorted, spine.mergeCounts, corrections),
  };
}

function derivedCounts(
  sorted: readonly ManifestRecord[], merge: LabelMergeCounts, corrections: readonly SpineCorrectionRow[],
): MembershipDerivedCounts {
  const owners = new Map<string, number>();
  for (const row of sorted) {
    for (const d of new Set(manifestDesignations(row))) owners.set(d, (owners.get(d) ?? 0) + 1);
  }
  return {
    labelNoOverlayEntry: merge.labelNoOverlayEntry,
    ...prefixed('labelAgree.', merge.labelAgree),
    ...prefixed('labelSpineOnly.', merge.labelSpineOnly),
    sharedDesignations: [...owners.values()].filter((n) => n > 1).length,
    rowsWithHdAlt: sorted.filter((r) => r.hdAlt.length > 0).length,
    rowsWithHrAlt: sorted.filter((r) => r.hrAlt.length > 0).length,
    ...prefixed('spineCellsCorrected.', fold(
      SPINE_CORRECTION_CELLS, corrections.filter((r) => r.op === 'set'), (r) => r.cell,
    )),
  };
}
