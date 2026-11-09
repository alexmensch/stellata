// The request-scoped Gaia DR3 pulls: astrometry in both scopes, GSPC synthetic photometry, the DR2 neighbourhood. See README.md.

import type { Column, Format } from '../pull/columns-pure';
import { near, present, type SpotRow } from '../pull/gates-pure';
import type { PullTable } from '../pull/pull';

export const GAIA_REQUEST_BATCH = 5_000;
export const DR2_REQUEST_BATCH = 2_500;
/** The most rows one DR3 id answers in the committed DR2 neighbourhood. */
export const DR2_ROWS_PER_ID = 4;
/** The least share of the request the astrometry answers: retracted DR3 sources fall short. */
export const MIN_ASTROMETRY_REACH = 0.95;
export const MIN_DR2_REACH = 0.97;

const DOUBLE_4: Format = { fixed: 4 };
const REAL_4: Format = { fixed: 4, float32: true };
const MAG: Format = { fixed: 6, float32: true };
const FLUX: Format = { exp: 6, float32: true };
const FLAG: Format = { flag: true };

export const ASTROMETRY_COLUMNS: readonly [Column, ...Column[]] = [
  { name: 'source_id' },
  { name: 'ra', format: { fixed: 9 } },
  { name: 'ra_error', format: REAL_4 },
  { name: 'dec', format: { fixed: 9 } },
  { name: 'dec_error', format: REAL_4 },
  { name: 'parallax', format: DOUBLE_4 },
  { name: 'parallax_error', format: REAL_4 },
  { name: 'pmra', format: DOUBLE_4 },
  { name: 'pmra_error', format: REAL_4 },
  { name: 'pmdec', format: DOUBLE_4 },
  { name: 'pmdec_error', format: REAL_4 },
  { name: 'ref_epoch' },
  { name: 'ruwe', format: REAL_4 },
  { name: 'ipd_frac_multi_peak' },
  { name: 'phot_g_mean_mag', format: MAG },
  { name: 'phot_bp_mean_mag', format: MAG },
  { name: 'phot_rp_mean_mag', format: MAG },
  { name: 'radial_velocity', format: REAL_4 },
  { name: 'radial_velocity_error', format: REAL_4 },
];

const requestOn = (key: string, ids: readonly bigint[], batchSize: number, rowsPerId: number) => ({
  kind: 'request' as const, key, idColumn: key, ids: ids.map(String), batchSize, rowsPerId,
});

/** A DR4 swap-in changes ref_epoch to 2017.5, which epoch propagation downstream does not assume. `motion` is null for a 2-parameter solution. */
export function astrometrySpot(
  sourceId: string, motion: readonly [number, number, number] | null, g: number, extra: SpotRow['cells'] = {},
): SpotRow {
  const [parallax, pmra, pmdec] = motion === null ? [null, null, null] : motion.map((v) => near(v, 0.001));
  return {
    key: 'source_id',
    value: sourceId,
    cells: { ref_epoch: '2016.0', parallax, pmra, pmdec, phot_g_mean_mag: near(g, 0.0001), ...extra },
  };
}

export function astrometryTable(ids: readonly bigint[], spotRows: readonly [SpotRow, ...SpotRow[]]): PullTable {
  return {
    from: 'gaiadr3.gaia_source',
    columns: ASTROMETRY_COLUMNS,
    sortBy: [{ column: 'source_id', as: 'integer' }],
    scope: { ...requestOn('source_id', ids, GAIA_REQUEST_BATCH, 1), coverage: { groups: [present('phot_g_mean_mag')] } },
    band: { min: Math.ceil(ids.length * MIN_ASTROMETRY_REACH), max: ids.length },
    spotRows,
  };
}

/** First request row, the row at the batch boundary, and the first HIP-anchored row. */
export const BINARIES_ASTROMETRY_SPOTS: readonly [SpotRow, ...SpotRow[]] = [
  astrometrySpot('594595272471808', [11.0297, 49.4157, -45.9419], 11.953011),
  astrometrySpot('3723554268436602240', [3.0991, -189.5386, -70.415], 5.87496),
  astrometrySpot('4923860051276772608', [16.1641, -202.7111, -71.6125], 10.588468),
];

/** First request row, a mid-file row, and Barnard's Star, whose radial velocity catches an all-null rv column. */
export const CATALOG_ASTROMETRY_SPOTS: readonly [SpotRow, ...SpotRow[]] = [
  astrometrySpot('7632157690368', [5.6023, 45.466, -6.8343], 8.068802),
  astrometrySpot('4040814466068502656', [3.4911, 2.6759, -5.679], 8.888946),
  astrometrySpot('4472832130942575872', [546.9759, -801.551, 10362.3942], 8.193974, {
    radial_velocity: near(-110.4682, 0.001), radial_velocity_error: near(0.1313, 0.001),
  }),
];

const band = (b: 'b' | 'v'): Column[] => [
  { name: `${b}_jkc_mag`, format: MAG },
  { name: `${b}_jkc_flux`, format: FLUX },
  { name: `${b}_jkc_flux_error`, format: FLUX },
  { name: `${b}_jkc_flag`, format: FLAG },
];

const gspcSpot = (sourceId: string, b: number | null, bFlag: string, v: number, vFlag: string): SpotRow => ({
  key: 'source_id',
  value: sourceId,
  cells: { b_jkc_mag: b === null ? null : near(b, 0.0001), b_jkc_flag: bFlag, v_jkc_mag: near(v, 0.0001), v_jkc_flag: vFlag },
});

/** The validated-range flag's two shapes and the per-band null: /data/gaia/README.md#the-gspc-validated-range-flag--1-means-in-range. */
export function gspcTable(ids: readonly bigint[]): PullTable {
  return {
    from: 'gaiadr3.synthetic_photometry_gspc',
    columns: [{ name: 'source_id' }, ...band('b'), ...band('v')],
    sortBy: [{ column: 'source_id', as: 'integer' }],
    scope: {
      ...requestOn('source_id', ids, GAIA_REQUEST_BATCH, 1),
      coverage: {
        groups: [
          { name: 'B and V both present', has: (cell) => present('b_jkc_mag').has(cell) && present('v_jkc_mag').has(cell) },
          { name: 'B and V both in validated range', has: (cell) => cell('b_jkc_flag') === '1' && cell('v_jkc_flag') === '1' },
        ],
      },
    },
    band: { min: 320_000, max: 370_000 },
    spotRows: [
      gspcSpot('36747057287093632', 11.890008, '1', 11.224282, '1'),
      gspcSpot('10625474212633728', null, '0', 11.702773, '1'),
      gspcSpot('4472832130942575872', 11.249152, '0', 9.555117, '0'),
    ],
  };
}

const dr2Spot = (dr3: string, dr2: string, distance: number, dmag: number, propagated: '0' | '1'): SpotRow => ({
  key: 'dr3_source_id',
  value: dr3,
  cells: { dr2_source_id: dr2, angular_distance: near(distance, 0.01), magnitude_difference: near(dmag, 0.001), proper_motion_propagation: propagated },
});

export function dr2NeighbourhoodTable(ids: readonly bigint[]): PullTable {
  return {
    from: 'gaiadr3.dr2_neighbourhood',
    columns: [
      { name: 'dr2_source_id' },
      { name: 'dr3_source_id' },
      { name: 'angular_distance', format: { fixed: 3, float32: true } },
      { name: 'magnitude_difference', format: { fixed: 3, float32: true } },
      { name: 'proper_motion_propagation', format: FLAG },
    ],
    sortBy: [{ column: 'dr3_source_id', as: 'integer' }, { column: 'angular_distance', as: 'decimal' }],
    scope: {
      ...requestOn('dr3_source_id', ids, DR2_REQUEST_BATCH, DR2_ROWS_PER_ID),
      coverage: { groups: [{ name: 'a DR2 candidate', has: () => true }], floor: MIN_DR2_REACH },
    },
    band: { min: 5_700, max: 6_100 },
    spotRows: [
      dr2Spot('9178383766474496', '9178383766474496', 0.265, -0.0169, '1'),
      dr2Spot('3017253180145915136', '3017253180145915136', 22.073, 0.246, '1'),
      dr2Spot('3017253184443743616', '3017253180145915136', 357.027, -0.0445, '0'),
    ],
  };
}
