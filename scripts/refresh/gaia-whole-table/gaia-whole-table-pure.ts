// The whole-table Gaia DR3 pulls: the HIP and TYC best-neighbour cross-walks. See README.md.

import type { SortKey } from '../pull/columns-pure';
import type { RowBand, SpotRow } from '../pull/gates-pure';
import type { PullTable } from '../pull/pull';
import { GAIA_SLICE_ROWS } from '../pull/tap-pure';
import { HIP_XMATCH_EDGES, TYC_XMATCH_EDGES } from './slice-edges';

const bySourceId = (edges: readonly [bigint, ...bigint[]]): PullTable['scope'] => (
  { kind: 'sliced', key: 'source_id', edges, sliceRows: GAIA_SLICE_ROWS }
);

const near = (value: number) => ({ near: value, within: 0.001 });

function xmatchTable(
  from: string, id: SortKey, edges: readonly [bigint, ...bigint[]], band: RowBand, spotRows: readonly [SpotRow, ...SpotRow[]],
): PullTable {
  return {
    from,
    where: 'source_id IS NOT NULL',
    columns: [
      { name: id.column, select: `original_ext_source_id AS ${id.column}` },
      { name: 'gaia_source_id', select: 'source_id AS gaia_source_id' },
      { name: 'angular_distance', format: { fixed: 6, float32: true } },
      { name: 'number_of_neighbours' },
      { name: 'xm_flag' },
    ],
    sortBy: [id],
    scope: bySourceId(edges),
    band,
    spotRows,
  };
}

const xmatchSpot = (key: 'hip' | 'tyc', value: string, gaiaSourceId: string, angularDistance: number): SpotRow => ({
  key, value, cells: { gaia_source_id: gaiaSourceId, angular_distance: near(angularDistance), number_of_neighbours: '1', xm_flag: '8' },
});

export const HIP_XMATCH = xmatchTable(
  'gaiadr3.hipparcos2_best_neighbour', { column: 'hip', as: 'integer' }, HIP_XMATCH_EDGES, { min: 99_400, max: 99_600 }, [
    xmatchSpot('hip', '8102', '2452378776434477184', 0.00754),
    xmatchSpot('hip', '38430', '5602025904044961536', 0.005562),
    xmatchSpot('hip', '46144', '1040043514891491968', 0.000844),
  ],
);

/** Spot rows spread across the Tycho region numbers, so a regional re-index surfaces. */
export const TYC_XMATCH = xmatchTable(
  'gaiadr3.tycho2tdsc_merge_best_neighbour', { column: 'tyc', as: 'text' }, TYC_XMATCH_EDGES, { min: 2_510_000, max: 2_530_000 }, [
    xmatchSpot('tyc', '2726-2257-1', '1948934357952258304', 0.160929),
    xmatchSpot('tyc', '4352-1171-1', '486100417131058048', 0.019045),
    xmatchSpot('tyc', '6455-874-1', '5083243951169606016', 0.046136),
  ],
);
