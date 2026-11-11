// Stage 7: every stage's counts, filed under the stage of the snapshot that pins them. See README.md.

import { nestByStage, type StagedCounts } from '../../util/counts/count-stages-pure';
import { stage3Counts } from '../astrometry/attach-astrometry';
import type { StageResults } from '../build-binaries';
import { stage1Counts } from '../load/reference-catalogs';
import { stage6Counts } from '../multiples/attach-multiples';
import { stage5Counts } from '../optical/attach-optical';
import { stage4Counts } from '../orbits/attach-orbits';
import { stage2Counts } from '../resolve/resolve-pairs';

type StageCountKey = keyof (
  ReturnType<typeof stage1Counts> & ReturnType<typeof stage2Counts> & ReturnType<typeof stage3Counts>
  & ReturnType<typeof stage4Counts> & ReturnType<typeof stage5Counts> & ReturnType<typeof stage6Counts>
);
const BINARIES_STAGES = ['ingest', 'subdivide', 'resolve', 'astrometry', 'orbits', 'optical', 'multiples'] as const;
type BinariesStage = (typeof BINARIES_STAGES)[number];

type Filed<T> = { [S in keyof T]: keyof T[S] }[keyof T];
type FiledTwice<T> = { [S in keyof T]: keyof T[S] & Filed<Omit<T, S>> }[keyof T];
type Unfiled<T> =
  | Exclude<StageCountKey, Filed<T>> | Exclude<Filed<T>, StageCountKey>
  | Exclude<keyof T, BinariesStage> | FiledTwice<T>;

/** `_everyKeyOnce` is `true` only when the stages file exactly the keys the stages count; otherwise its type names the stray keys. */
function filed<T extends Readonly<Record<BinariesStage, Readonly<Record<string, number>>>>>(
  stages: T,
  _everyKeyOnce: [Unfiled<T>] extends [never] ? true : Unfiled<T>,
): StagedCounts<number> {
  const blocks = BINARIES_STAGES.map((stage) => ({ stage, block: { kind: 'counted' as const, counts: stages[stage] } }));
  return nestByStage<never, BinariesStage, number>({}, { order: BINARIES_STAGES, of: {} }, blocks);
}

function withPrefix<K extends string, P extends string>(counts: Readonly<Record<K, number>>, prefix: P): Record<Extract<K, `${P}${string}`>, number> {
  return Object.fromEntries(Object.entries<number>(counts).filter(([key]) => key.startsWith(prefix))) as Record<Extract<K, `${P}${string}`>, number>;
}

export function binariesCounts(r: StageResults): StagedCounts<number> {
  const s1 = stage1Counts(r.reference);
  const { ccdm_sibling_owned_rejected, ...bindingIntegrity } = stage2Counts(r.resolved);
  const s3 = stage3Counts(r.reference, r.resolved, r.astrometry);
  return filed({
    ingest: {
      wds_pairs_total: s3.wds_pairs_total,
      wds_duplicate_pair_rows_dropped: s1.wds_duplicate_pair_rows_dropped,
      msc_orbits_unmapped: s1.msc_orbits_unmapped,
      xwalk_hip_mag_rejected: s1.xwalk_hip_mag_rejected,
      athyg_gaia_mag_rejected: s1.athyg_gaia_mag_rejected,
    },
    subdivide: {
      synthesized_orb6_orphan_pairs: s1.synthesized_orb6_orphan_pairs,
      synthesized_nss_inner_pairs: s3.synthesized_nss_inner_pairs,
      synthesized_msc_inner_pairs: s1.synthesized_msc_inner_pairs,
    },
    resolve: {
      blank_components_rescued: s1.blank_components_rescued,
      blank_components_deferred: s1.blank_components_deferred,
      ccdm_sibling_owned_rejected,
      athyg_match_sibling_claimed_rejected: s3.athyg_match_sibling_claimed_rejected,
      decomposing_pairs: s3.decomposing_pairs,
      components_total: s3.components_total,
      ...withPrefix(s3, 'resolution_'),
      ...bindingIntegrity,
    },
    astrometry: withPrefix(s3, 'astrometry_'),
    orbits: stage4Counts(r.orbits),
    optical: stage5Counts(r.optical),
    multiples: stage6Counts(r.multiples),
  }, true);
}
