// buildMembership: the membership phases wired in order — corrections, the pair rule, spine bindings, spine side, the merge derivation, folds, additions, magnitude term. Contract: /docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries.

import type { ClassicIdOverlay } from '../classic-ids/classic-id-overlay-pure';
import type { LabelMergeCounts, LabelOverrides } from '../classic-ids/label-merge/label-merge-pure';
import { fold, prefixed } from '../../util/counts/tally-pure';
import type { IdentityRow } from '../lineage/identity/identity-pure';
import { identityRow } from '../lineage/identity/identity-pure';
import type { LineageRow } from '../lineage/lineage-row-pure';
import type { SpineRow } from '../spine/inherited-spine-pure';
import { indexPrimaries, spineKeys, type PrimaryTables } from '../spine/primaries-audit-pure';
import { admitAdditions } from './additions/admission-pure';
import type { BindingEvidence } from './binding/binding-gate-pure';
import { ownCandidates, queuedIdentities, rowDeriver } from './binding/binding-outcomes-pure';
import type { PositionEvidence } from './binding/binding-derivation-pure';
import { settleSpineBindings } from './binding/spine-settle-pure';
import type { BindingDispositionRow } from './binding/binding-review-dispositions-pure';
import { magnitudeTermRows } from './magnitude-term/magnitude-rows-pure';
import {
  mergeDivergences, pairLinksFrom, pairRuleTycHdRequest, requestedTycHds, settlePairRule,
} from './merge-derivation/merge-derivation-pure';
import type { SimbadTycHdRow } from '../simbad/simbad-tyc-hd-parse';
import { lookupGliese } from '../gliese-parse-pure';
import { refusalRows, type CatalogueKeys, type FlamsteedRefusalRow } from '../simbad/flamsteed-refusals-pure';
import { requireWitnessedKeeps, type PairDisposition } from './pair-review-dispositions-pure';
import type { MagnitudeTermSelection } from './magnitude-term/magnitude-term-pure';
import {
  membershipLedgers,
  membershipLineageRow,
  type KeyedOutcome,
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
  /** HIP2's positions and Gaia's, which the identity witness holds against each other. */
  positions: PositionEvidence;
  /** The committed dispositions of the binding review queue, by
   *  `bindingReviewKey`. */
  dispositions: ReadonlyMap<string, BindingDispositionRow>;
  /** The committed corrections to AT-HYG's merge decisions
   *  (spine-corrections/README.md). */
  corrections: readonly SpineCorrectionRow[];
  /** SIMBAD's TYC→HD pull, which can refuse a pair move (merge-derivation/README.md#applying-the-pair-rule). */
  simbadTycHd: ReadonlyMap<string, SimbadTycHdRow>;
  /** The committed dispositions of the pair-review queue, by HIP (merge-derivation/README.md#disposing-a-queued-pair). */
  pairDispositions: ReadonlyMap<number, PairDisposition>;
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
  flamsteedRefusals: FlamsteedRefusalRow[];
  derived: MembershipDerivedCounts;
}

export function buildMembership(input: MembershipInput): MembershipResult {
  const { tables, evidence, keys, corrections } = input;
  const idx = indexPrimaries(tables);
  const correctedSpine = applySpineCorrections(input.spine, corrections);
  const { corrected, keptSpineIndex, folds } = correctedSpine;
  const pairLinks = pairLinksFrom(tables);
  requireWitnessedKeeps(input.pairDispositions, {
    printedHipV: evidence.printedV.printed_hip,
    vtOf: (tyc) => tables.tycho2.get(tyc)?.vtMag ?? null,
    positionWitness: pairLinks.positionWitness,
  });
  const derive = rowDeriver(tables, idx, evidence, input.positions);
  const keyOf = (keptRow: number): string => keys.spine(keptSpineIndex[keptRow]);
  const tycHds = requestedTycHds(input.simbadTycHd, pairRuleTycHdRequest(tables.iv25.map((r) => r.tyc), tables.tycho2));

  const pair = settlePairRule(
    correctedSpine.kept, pairLinks, (row) => derive(row).derived.sourceId, input.pairDispositions, tycHds,
    (rows) => {
      const settlement = settleSpineBindings({
        kept: rows, keyOf, derive, dispositions: input.dispositions, evidence, tables,
      });
      const spine = spineSide({
        kept: rows, keyOf, settled: settlement.rows, overlay: input.overlay, overrides: input.overrides,
        siblingRenderedSourceIds: input.siblingRenderedSourceIds, tables, idx,
      });
      return { value: { settlement, spine }, shippedHd: (i) => spine.rows[i].hd };
    },
  );
  const { rows: kept, decided, received, value: { settlement, spine } } = pair;
  const keptKeys = spineKeys(kept);
  const mergeLinks = {
    ...pairLinks,
    held: keptKeys,
    closePair: {
      iv25Hds: (tyc: string) => pairLinks.links.tycHd.get(tyc),
      simbadTycHd: input.simbadTycHd,
      simbadObjectOf: (sourceId: string) => tables.simbadBySourceId.get(sourceId)?.oid,
    },
    positional: {
      v70a: (gl: string) => lookupGliese(tables.gliese, gl)?.astrometryB1950 ?? null,
      tycho2: (tyc: string) => tables.tycho2.get(tyc),
    },
  };
  const merge: KeyedOutcome[] = kept.flatMap((row, i) => mergeDivergences(
    row, spine.rows[i], mergeLinks, decided.get(i), received.has(i),
  ).map(
    (divergence) => ({ key: keyOf(i), outcome: { kind: 'merge', divergence } }),
  ));
  const folded = foldOutcomes(folds, corrected, spine.rows, keys.spine);
  const additions = admitAdditions({
    tables, idx, spineKeys: keptKeys, spineRecords: spine.records, derive, keys,
    publishesGaiaParallax: input.publishesGaiaParallax,
  });
  const primariesRows = [...spine.rows, ...additions.rows];
  const magnitude = magnitudeTermRows(
    input.magnitudeTerm, primariesRows,
    ownCandidates([...settlement.unshipped, ...additions.unshipped]), keys.gaia,
  );

  const identityQueue = queuedIdentities(
    [...settlement.identityQueue, ...additions.identityQueue],
    new Set(magnitude.rows.flatMap((r) => (r.gaiaSourceId === null ? [] : [r.gaiaSourceId]))),
  );
  const rows = [...primariesRows, ...magnitude.rows];
  const identity = [
    ...folded.identity,
    ...additions.identity,
    ...rows.map((r) => identityRow(r.originKey, MEMBERSHIP_MANIFEST.encode(r), manifestDesignations(r))),
  ];
  const lineage = [
    ...settlement.outcomes, ...spine.outcomes, ...merge, ...folded.outcomes, ...additions.outcomes, ...magnitude.outcomes, ...identityQueue,
  ].map(membershipLineageRow);
  const ledgers = membershipLedgers(lineage, new Map(identity.map((r) => [r.key, r])));
  const sorted = sortManifestRecords(rows);
  const flamsteedRefusals = refusalRows(tables.simbadFlamsteed, catalogueKeys(sorted));
  return {
    rows: sorted, ...ledgers, lineage, identity, flamsteedRefusals,
    derived: derivedCounts(sorted, spine.mergeCounts, corrections, flamsteedRefusals),
  };
}

function catalogueKeys(rows: readonly ManifestRecord[]): CatalogueKeys {
  const hips = new Set<number>();
  const hds = new Set<number>();
  for (const row of rows) {
    if (row.hip !== null) hips.add(row.hip);
    for (const hd of row.hd === null ? row.hdAlt : [row.hd, ...row.hdAlt]) hds.add(hd);
  }
  return { hips, hds };
}

function derivedCounts(
  sorted: readonly ManifestRecord[], merge: LabelMergeCounts, corrections: readonly SpineCorrectionRow[],
  flamsteedRefusals: readonly FlamsteedRefusalRow[],
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
    flamsteedRefusals: flamsteedRefusals.length,
    ...prefixed('spineCellsCorrected.', fold(
      SPINE_CORRECTION_CELLS, corrections.filter((r) => r.op === 'set'), (r) => r.cell,
    )),
  };
}
