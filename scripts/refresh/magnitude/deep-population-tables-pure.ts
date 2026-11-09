// The two tables pulled over the deep population: Apsis astrophysical parameters and Bailer-Jones distances. See README.md#the-deep-population.

import type { Cell, Format } from '../pull/columns-pure';
import { coverageCheck, type CoverageGroup, type SpotRow } from '../pull/gates-pure';
import type { DeepPopulationTable } from './deep-population-pure';

const near = (value: number, within: number) => ({ near: value, within });

const coverageOfPulled = (label: string, cells: readonly Cell[], groups: readonly [CoverageGroup, ...CoverageGroup[]], floor?: number) => (
  coverageCheck(label, cells, 'source_id', cells.length, { groups, ...(floor === undefined ? {} : { floor }) })
);

const TEFF: Format = { fixed: 1, float32: true };
const DEX: Format = { fixed: 4, float32: true };

/** Both of a pipeline's Teff and log g present: the bucket the spectral resolver ingests. */
const teffAndLogg = (pipeline: 'gspphot' | 'gspspec'): CoverageGroup => ({
  name: `teff_${pipeline} and logg_${pipeline}`,
  has: (cell) => cell(`teff_${pipeline}`) !== null && cell(`logg_${pipeline}`) !== null,
});

/** ESP-HS's own not-determined value would let the floor pass on a pull that resolved nothing. */
const spectralTypeResolved: CoverageGroup = {
  name: 'spectraltype_esphs resolved',
  has: (cell) => {
    const value = cell('spectraltype_esphs')?.trim().toLowerCase() ?? '';
    return value !== '' && value !== 'unknown';
  },
};

/** Measured over the deep population 2026-09-19: Teff+log g union 89.9%, spectral type resolved 98.9%. */
export const MIN_APSIS_TEFF_LOGG = 0.8;
export const MIN_APSIS_SPECTRAL_TYPE = 0.9;

const apsisSpot = (sourceId: string, phot: readonly [number, number, number, number] | null, spec: readonly [number, number, number] | null): SpotRow => ({
  key: 'source_id',
  value: sourceId,
  cells: {
    teff_gspphot: phot && near(phot[0], 0.01),
    logg_gspphot: phot && near(phot[1], 0.001),
    mh_gspphot: phot && near(phot[2], 0.001),
    azero_gspphot: phot && near(phot[3], 0.001),
    teff_gspspec: spec && near(spec[0], 0.1),
    logg_gspspec: spec && near(spec[1], 0.01),
    mh_gspspec: spec && near(spec[2], 0.01),
  },
});

/** Spot rows across Apsis's three coverage shapes: both pipelines, BP/RP only, and a row whose every parameter is masked. */
export const APSIS_TABLE: DeepPopulationTable = {
  from: 'gaiadr3.astrophysical_parameters',
  values: [
    { name: 'teff_gspphot', format: TEFF },
    { name: 'logg_gspphot', format: DEX },
    { name: 'mh_gspphot', format: DEX },
    { name: 'azero_gspphot', format: DEX },
    { name: 'teff_gspspec', format: TEFF },
    { name: 'logg_gspspec', format: DEX },
    { name: 'mh_gspspec', format: DEX },
    { name: 'spectraltype_esphs' },
  ],
  magnitudeBand: { min: 1_222_000, max: 1_260_000 },
  spotRows: [
    apsisSpot('164919361120841856', [6115.373, 3.4688, -0.4904, 0.677], [6624, 4.17, -0.07]),
    apsisSpot('1631144127080202752', [6807.42, 3.6578, -0.3636, 0.0655], null),
    apsisSpot('3305738406773071744', null, null),
  ],
  checks: (label, cells) => [
    coverageOfPulled(`${label} Teff and log g`, cells, [teffAndLogg('gspphot'), teffAndLogg('gspspec')], MIN_APSIS_TEFF_LOGG),
    coverageOfPulled(`${label} spectral type`, cells, [spectralTypeResolved], MIN_APSIS_SPECTRAL_TYPE),
  ],
};

const DISTANCE: Format = { fixed: 3, float32: true };

const present = (column: string): CoverageGroup => ({ name: column, has: (cell) => cell(column) !== null });

const bailerJonesSpot = (sourceId: string, geo: number, photogeo: number, flag: string): SpotRow => ({
  key: 'source_id', value: sourceId, cells: { r_med_geo: near(geo, 0.5), r_med_photogeo: near(photogeo, 0.5), flag },
});

/** The four catastrophic-parallax-inversion supergiants HIP 22365, 25733, 38430 and 46144, and the well-measured F dwarf HIP 23785. */
export const BAILER_JONES_TABLE: DeepPopulationTable = {
  from: 'external.gaiaedr3_distance',
  values: [
    ...(['r_med_geo', 'r_lo_geo', 'r_hi_geo', 'r_med_photogeo', 'r_lo_photogeo', 'r_hi_photogeo'] as const).map((name) => ({ name, format: DISTANCE })),
    { name: 'flag' },
  ],
  magnitudeBand: { min: 1_210_000, max: 1_262_000 },
  spotRows: [
    bailerJonesSpot('204531088580182016', 6366.668, 6244.791, '10033'),
    bailerJonesSpot('183255985260080896', 5839.921, 5466.246, '10033'),
    bailerJonesSpot('5602025904044961536', 6622.035, 6215.232, '10033'),
    bailerJonesSpot('1040043514891491968', 7509.293, 7515.496, '10022'),
    bailerJonesSpot('4773096563064098432', 93.528, 92.871, '10023'),
  ],
  checks: (label, cells) => [coverageOfPulled(`${label} distances`, cells, [present('r_med_photogeo'), present('r_med_geo')])],
};
