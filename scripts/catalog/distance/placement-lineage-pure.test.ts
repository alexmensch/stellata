import { describe, expect, it } from 'vitest';

import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { MAGNITUDE_PULL } from '../membership/magnitude-term/magnitude-pull-source';
import { GAIA_ASTROMETRY } from './gaia-astrometry-source';
import { HIP2 } from './hip2-source';
import { BAILER_JONES } from './refinement/bailer-jones-source';
import { SIMBAD_VALUES } from '../simbad/simbad-values-source';
import type { DirectionSolution } from './direction-cascade';
import type { ParkedLedgerEntry } from './parallax/parked-ledger';
import {
  PLACEMENT_CODES, parkedLedgerView, placementLineageRows, type Placement,
} from './placement-lineage-pure';

const SOURCE = '2000000000000000001';
const GAIA = sourceRowRef(GAIA_ASTROMETRY, SOURCE);
const HIP = sourceRowRef(HIP2, 37);
const SIMBAD = sourceRowRef(SIMBAD_VALUES, 9);
const BJ = sourceRowRef(BAILER_JONES, SOURCE);
const SOLUTION: DirectionSolution = {
  srcRaDeg: 0, srcDecDeg: 0, srcEpoch: 2016, srcPmraMasyr: 1, srcPmdecMasyr: 1, velVia: 'gaia_pm',
};

const codes = (p: Placement): string[] => placementLineageRows(p).map((r) => `${r.role} ${r.code}`);

describe('placementLineageRows', () => {
  it('pins one star\'s placement chain, its refused tiers included', () => {
    const p: Placement = {
      kind: 'placed',
      key: 'spine:12',
      parallax: { via: 'gaia_dr3_inversion', value: { mas: 2, errMas: 0.1 }, evidence: [GAIA], refusals: [] },
      direction: {
        via: 'hip2_pm_discrepant',
        value: { ...SOLUTION, velVia: 'hip2_pm' },
        evidence: [HIP],
        refusals: [{ tier: 'gaia_5p', reason: 'pm_disagrees_with_hip2', ref: GAIA }],
      },
      gaia2p: false,
      pmRescue: null,
      bailerJones: { kind: 'override', ref: BJ },
      lmc: 'not_member',
      rv: {
        kind: 'kept',
        rv: {
          via: 'simbad',
          value: { kmS: 12, bibcode: '1953GCRV..C......0W', ref: SIMBAD },
          evidence: [SIMBAD],
          refusals: [],
        },
      },
      velocityClamped: false,
    };
    expect(placementLineageRows(p)).toEqual([
      {
        stage: 'placement', key: 'spine:12', role: 'outcome', code: 'placement.parallax.gaia-dr3-inversion',
        params: '', evidence: [`gaia-dr3-astrometry:${SOURCE}`],
      },
      {
        stage: 'placement', key: 'spine:12', role: 'refused', code: 'placement.direction.refused.pm-disagrees-with-hip2',
        params: '{"tier":"gaia_5p"}', evidence: [`gaia-dr3-astrometry:${SOURCE}`],
      },
      {
        stage: 'placement', key: 'spine:12', role: 'outcome', code: 'placement.direction.hip2-pm-discrepant',
        params: '', evidence: ['i311:37'],
      },
      {
        stage: 'placement', key: 'spine:12', role: 'outcome', code: 'placement.distance.bailer-jones',
        params: '', evidence: [`i352:${SOURCE}`],
      },
      {
        stage: 'placement', key: 'spine:12', role: 'outcome', code: 'placement.rv.simbad',
        params: '', evidence: ['simbad:9'],
      },
    ]);
  });

  it('cites no row that is the record\'s own origin', () => {
    const key = `gaia-dr3:${SOURCE}`;
    const own = sourceRowRef(MAGNITUDE_PULL, SOURCE);
    const [row] = placementLineageRows({
      kind: 'parked-no-v',
      key,
      ids: { tyc: null, hip: null, hd: null, gl: null, gaiaSourceId: SOURCE },
      parallax: { via: 'gaia_dr3_inversion', value: { mas: 2, errMas: 0.1 }, evidence: [own], refusals: [] },
    });
    expect(row.evidence).toEqual([]);
  });

  it('splits the gaia_5p route\'s position-only branch by its own code', () => {
    const placed = (gaia2p: boolean): Placement => ({
      kind: 'placed',
      key: 'spine:1',
      parallax: { via: 'pair_member_parallax', value: { mas: 2, errMas: 0.1 }, evidence: [GAIA], refusals: [] },
      direction: { via: 'gaia_5p', value: SOLUTION, evidence: [GAIA], refusals: [] },
      gaia2p,
      pmRescue: { via: 'none', refusals: [] },
      bailerJones: { kind: 'not-applied' },
      lmc: 'not_member',
      rv: { kind: 'kept', rv: { via: 'none', refusals: [] } },
      velocityClamped: false,
    });
    expect(codes(placed(true))).toContain('outcome placement.direction.gaia-2p');
    expect(codes(placed(false))).toContain('outcome placement.direction.gaia-5p');
    expect(codes(placed(true))).toContain('outcome placement.pm-rescue.none');
  });

  it('writes a rejected radial term as its own outcome, and the steps that only fire when they do', () => {
    const p: Placement = {
      kind: 'placed',
      key: 'spine:2',
      parallax: { via: 'curated', value: null, evidence: [], refusals: [] },
      direction: { via: 'curated', value: SOLUTION, evidence: [], refusals: [] },
      gaia2p: false,
      pmRescue: null,
      bailerJones: { kind: 'absent' },
      lmc: 'parallax_rules_out',
      rv: {
        kind: 'rejected',
        rv: { via: 'simbad', value: { kmS: 6824.7, bibcode: 'x', ref: SIMBAD }, evidence: [SIMBAD], refusals: [] },
      },
      velocityClamped: true,
    };
    expect(codes(p)).toEqual([
      'outcome placement.parallax.curated',
      'outcome placement.direction.curated',
      'outcome placement.distance.bailer-jones-absent',
      'refused placement.distance.lmc-refused-by-own-parallax',
      'outcome placement.rv.rejected-above-ceiling',
      'outcome placement.velocity.clamped',
    ]);
  });

  it('writes a parked record\'s steps up to the park, then the park', () => {
    expect(codes({
      kind: 'parked-no-position',
      key: 'spine:3',
      ids: { tyc: null, hip: 88759, hd: null, gl: null, gaiaSourceId: null },
      parallax: { via: 'pair_member_parallax', value: { mas: 2, errMas: 0.1 }, evidence: [GAIA], refusals: [] },
      direction: { via: 'none', refusals: [] },
    })).toEqual([
      'outcome placement.parallax.pair-member-parallax',
      'outcome placement.park.no-position',
    ]);
    expect(codes({
      kind: 'parked-parallax',
      key: 'spine:4',
      ids: { tyc: null, hip: 37, hd: null, gl: null, gaiaSourceId: null },
      parallax: {
        via: 'none',
        refusals: [{ tier: 'hip2_parallax', reason: 'below_sn_floor', mas: 2.62, ref: HIP }],
      },
    })).toEqual([
      'refused placement.parallax.refused.below-sn-floor',
      'outcome placement.park.refused-no-defensible-parallax',
    ]);
  });

  it('declares every park code with the park effect', () => {
    for (const [branch, d] of Object.entries(PLACEMENT_CODES.declarations)) {
      expect(d.effect, branch).toBe(branch.startsWith('park.') ? 'park' : 'none');
    }
  });
});

describe('parkedLedgerView', () => {
  it('reads back exactly the ledger entries the park rows were written from', () => {
    const entries: ParkedLedgerEntry[] = [
      { tyc: '1-2-1', hip: 7, hd: 55, gl: 'Gl 1', gaiaSourceId: SOURCE, reason: 'no_v_magnitude' },
      { tyc: null, hip: null, hd: null, gl: null, gaiaSourceId: SOURCE, reason: 'no_parallax_published' },
    ];
    const rows = entries.flatMap(({ reason, ...ids }, i) => placementLineageRows({
      kind: reason === 'no_v_magnitude' ? 'parked-no-v' : 'parked-parallax',
      key: `spine:${i}`,
      ids,
      parallax: reason === 'no_v_magnitude'
        ? { via: 'gaia_dr3_inversion', value: { mas: 2, errMas: 0.1 }, evidence: [GAIA], refusals: [] }
        : { via: 'none', refusals: [] },
    }));
    expect(parkedLedgerView(rows)).toEqual(entries);
  });

  it('refuses a malformed identifier cell rather than reading it as a number', () => {
    const [row] = placementLineageRows({
      kind: 'parked-no-v',
      key: 'spine:1',
      ids: { tyc: null, hip: 7, hd: null, gl: null, gaiaSourceId: null },
      parallax: { via: 'gaia_dr3_inversion', value: { mas: 2, errMas: 0.1 }, evidence: [GAIA], refusals: [] },
    }).filter((r) => r.code === 'placement.park.no-v-magnitude');
    expect(() => parkedLedgerView([{ ...row, params: row.params.replace('"7"', '"7x"') }]))
      .toThrow('"7x" is not an integer');
  });
});
