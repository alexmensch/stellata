// Stage 7: every stage's counts and rates, filed under the stage of the snapshot that pins them. See README.md.

import type { StagedCounts } from '../../util/counts/count-stages-pure';
import { stage3Counts, stage3Rates } from '../astrometry/attach-astrometry';
import type { StageResults } from '../build-binaries';
import { stage1Counts } from '../load/reference-catalogs';
import { stage6Counts } from '../multiples/attach-multiples';
import { stage5Counts, stage5Rates } from '../optical/attach-optical';
import { stage4Counts, stage4Rates } from '../orbits/attach-orbits';
import { stage2Counts } from '../resolve/resolve-pairs';

function withPrefix<K extends string, P extends string>(counts: Readonly<Record<K, number>>, prefix: P): Record<Extract<K, `${P}${string}`>, number> {
  return Object.fromEntries(Object.entries<number>(counts).filter(([key]) => key.startsWith(prefix))) as Record<Extract<K, `${P}${string}`>, number>;
}

export function binariesCounts(r: StageResults): StagedCounts<number> {
  const s1 = stage1Counts(r.reference);
  const { ccdm_sibling_owned_rejected, ...bindingIntegrity } = stage2Counts(r.resolved);
  const s3 = stage3Counts(r.reference, r.resolved, r.astrometry);
  return {
    stages: {
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
    },
  };
}

export function binariesRates(r: StageResults): StagedCounts<number> {
  const { gaia_resolve_rate, hip2_fallback_rate } = stage3Rates(stage3Counts(r.reference, r.resolved, r.astrometry));
  return {
    stages: {
      resolve: { gaia_resolve_rate },
      astrometry: { hip2_fallback_rate },
      orbits: stage4Rates(stage4Counts(r.orbits)),
      optical: stage5Rates(stage5Counts(r.optical)),
    },
  };
}
