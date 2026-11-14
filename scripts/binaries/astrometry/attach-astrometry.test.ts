import { describe, expect, it } from 'vitest';

import { emptyTallyPartition, prefixed } from '../../util/counts/tally-pure';
import { RESOLVE_VIA } from '../multiples-tsv';
import { stage3Rates, type Stage3Counts } from './attach-astrometry';
import { ROUTED_VIA } from './routes-pure';

const counts = (over: Partial<Stage3Counts>): Stage3Counts => ({
  wds_pairs_total: 0, synthesized_nss_inner_pairs: 0, athyg_match_sibling_claimed_rejected: 0, decomposing_pairs: 0, components_total: 0,
  ...prefixed('resolution_', emptyTallyPartition(RESOLVE_VIA)),
  ...prefixed('astrometry_', emptyTallyPartition(ROUTED_VIA)),
  ...over,
});

describe('stage3Rates', () => {
  it('rates the source-anchored tiers and the HIP2 route over every component', () => {
    expect(stage3Rates(counts({ components_total: 8, resolution_orb6_hip: 3, resolution_ccdm_hip: 2, astrometry_hip2_long_baseline: 2 })))
      .toEqual({ gaia_resolve_rate: { kind: 'rated', value: 0.375 }, hip2_fallback_rate: { kind: 'rated', value: 0.25 } });
  });

  it('counts the position_pm and position_nopm tiers as Gaia-resolved, and ccdm_hip and unresolved as not', () => {
    const tiers = {
      resolution_orb6_hip: 1, resolution_athyg_gaia_native: 1, resolution_simbad_xid: 1,
      resolution_position_pm: 2, resolution_position_nopm: 3, resolution_ccdm_hip: 4, resolution_unresolved: 4,
    };
    expect(stage3Rates(counts({ components_total: 16, ...tiers })).gaia_resolve_rate).toEqual({ kind: 'rated', value: 0.5 });
  });

  it('has no denominator for either rate when there are no components', () => {
    expect(stage3Rates(counts({})))
      .toEqual({ gaia_resolve_rate: { kind: 'no-denominator' }, hip2_fallback_rate: { kind: 'no-denominator' } });
  });
});
