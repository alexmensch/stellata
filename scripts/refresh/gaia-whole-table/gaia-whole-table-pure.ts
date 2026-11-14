// The whole-table Gaia DR3 pulls: the HIP and TYC best-neighbour cross-walks and the NSS two-body orbits. See README.md.

import type { Column, SortKey } from '../pull/columns-pure';
import { near, type RowBand, type SpotRow } from '../pull/gates-pure';
import type { PullTable } from '../pull/pull';
import { GAIA_SLICE_ROWS } from '../pull/tap-pure';
import { HIP_XMATCH_EDGES, NSS_EDGES, TYC_XMATCH_EDGES } from './slice-edges';

const pinned = (value: number) => near(value, 0.001);

const bySourceId = (edges: readonly [bigint, ...bigint[]]): PullTable['scope'] => (
  { kind: 'sliced', key: 'source_id', edges, sliceRows: GAIA_SLICE_ROWS }
);

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
  key, value, cells: { gaia_source_id: gaiaSourceId, angular_distance: pinned(angularDistance), number_of_neighbours: '1', xm_flag: '8' },
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

const NSS_ELEMENTS = [
  'period', 't_periastron', 'eccentricity', 'a_thiele_innes', 'b_thiele_innes', 'f_thiele_innes', 'g_thiele_innes',
  'c_thiele_innes', 'h_thiele_innes', 'inclination', 'arg_periastron', 'mass_ratio',
] as const;

/** Each element a DOUBLE and its error a REAL; the two fit statistics are REALs. */
const NSS_COLUMNS: readonly [Column, ...Column[]] = [
  { name: 'source_id' },
  { name: 'nss_solution_type' },
  ...NSS_ELEMENTS.flatMap((element): Column[] => [
    { name: element, format: { repr: true } },
    { name: `${element}_error`, format: { repr: true, float32: true } },
  ]),
  { name: 'goodness_of_fit', format: { repr: true, float32: true } },
  { name: 'significance', format: { repr: true, float32: true } },
];

const THIELE_INNES = ['a_thiele_innes', 'b_thiele_innes', 'f_thiele_innes', 'g_thiele_innes'] as const;

/** One row per solution family a DR4 rename or re-routing would touch: astrometric, targeted-search, and SB1 with no Thiele-Innes. */
export const NSS_TWO_BODY: PullTable = {
  from: 'gaiadr3.nss_two_body_orbit',
  columns: NSS_COLUMNS,
  sortBy: [{ column: 'source_id', as: 'integer' }, { column: 'nss_solution_type', as: 'text' }],
  scope: bySourceId(NSS_EDGES),
  band: { min: 440_000, max: 446_000 },
  spotRows: [
    {
      key: 'source_id',
      value: '6360853029303982592',
      cells: {
        nss_solution_type: 'Orbital', period: pinned(466.2104), eccentricity: pinned(0.7918), a_thiele_innes: pinned(-4.6393),
        b_thiele_innes: pinned(-0.0809), f_thiele_innes: pinned(3.5245), g_thiele_innes: pinned(1.1596), mass_ratio: null,
      },
    },
    {
      key: 'source_id',
      value: '5823248090239625088',
      cells: {
        nss_solution_type: 'OrbitalTargetedSearch', period: pinned(488.4292), eccentricity: pinned(0.1495), a_thiele_innes: pinned(0.1156),
        b_thiele_innes: pinned(-0.171), f_thiele_innes: pinned(1.2353), g_thiele_innes: pinned(2.1121), mass_ratio: null,
      },
    },
    {
      key: 'source_id',
      value: '4648984790038560256',
      cells: {
        nss_solution_type: 'SB1', period: pinned(524.0654), eccentricity: pinned(0.0815), mass_ratio: null,
        ...Object.fromEntries(THIELE_INNES.map((c) => [c, null])),
      },
    },
  ],
};
