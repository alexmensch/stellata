// The binaries' Gaia DR3 tables: the 5p astrometry pull and the NSS two-body orbits.

import type { Declared } from '../../util/sources/source';
import { readTable, type ColumnTable } from '../../util/tsv/table-pure';

/** One row of the binaries' astrometry pull: the 5p solution, the two fit
 *  flags behind the NSS-systemic route, and the photometry. */
export interface GaiaAstrometryRow {
  readonly sourceId: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly parallaxMas: number | null;
  readonly parallaxErrorMas: number | null;
  readonly pmraMasyr: number | null;
  readonly pmraErrorMasyr: number | null;
  readonly pmdecMasyr: number | null;
  readonly pmdecErrorMasyr: number | null;
  readonly refEpoch: number;
  readonly ruwe: number | null;
  readonly ipdFracMultiPeak: number | null;
  readonly gMag: number | null;
  readonly bpMag: number | null;
  readonly rpMag: number | null;
}

/** The NSS two-body columns the orbit stages read. */
export interface NssOrbitRow {
  readonly sourceId: string;
  readonly solutionType: string;
  readonly period: number | null;
  readonly tPeriastron: number | null;
  readonly eccentricity: number | null;
  readonly aThieleInnes: number | null;
  readonly bThieleInnes: number | null;
  readonly fThieleInnes: number | null;
  readonly gThieleInnes: number | null;
  readonly inclination: number | null;
  readonly argPeriastron: number | null;
  readonly massRatio: number | null;
}

const ASTROMETRY_COLUMNS = [
  'source_id', 'ra', 'dec', 'parallax', 'parallax_error', 'pmra', 'pmra_error', 'pmdec', 'pmdec_error',
  'ref_epoch', 'ruwe', 'ipd_frac_multi_peak', 'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag',
] as const;

export function parseGaiaAstrometry(text: string, from: Declared): Map<string, GaiaAstrometryRow> {
  const out = new Map<string, GaiaAstrometryRow>();
  for (const row of readTable({ ...from, columns: ASTROMETRY_COLUMNS }, text)) {
    const sourceId = row.sourceId('source_id');
    const raDeg = row.float('ra');
    const decDeg = row.float('dec');
    const refEpoch = row.float('ref_epoch');
    if (sourceId === null || raDeg === null || decDeg === null || refEpoch === null) continue;
    out.set(sourceId, {
      sourceId, raDeg, decDeg, refEpoch,
      parallaxMas: row.float('parallax'),
      parallaxErrorMas: row.float('parallax_error'),
      pmraMasyr: row.float('pmra'),
      pmraErrorMasyr: row.float('pmra_error'),
      pmdecMasyr: row.float('pmdec'),
      pmdecErrorMasyr: row.float('pmdec_error'),
      ruwe: row.float('ruwe'),
      ipdFracMultiPeak: row.float('ipd_frac_multi_peak'),
      gMag: row.float('phot_g_mean_mag'),
      bpMag: row.float('phot_bp_mean_mag'),
      rpMag: row.float('phot_rp_mean_mag'),
    });
  }
  return out;
}

const NSS_COLUMNS = [
  'source_id', 'nss_solution_type', 'period', 't_periastron', 'eccentricity',
  'a_thiele_innes', 'b_thiele_innes', 'f_thiele_innes', 'g_thiele_innes',
  'inclination', 'arg_periastron', 'mass_ratio',
] as const;

/** source_id → its orbit. A source with several solutions keeps the last. */
export function parseNssOrbits(table: ColumnTable): Map<string, NssOrbitRow> {
  const out = new Map<string, NssOrbitRow>();
  for (const row of table(NSS_COLUMNS)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId === null) continue;
    out.set(sourceId, {
      sourceId,
      solutionType: row.text('nss_solution_type') ?? '',
      period: row.float('period'),
      tPeriastron: row.float('t_periastron'),
      eccentricity: row.float('eccentricity'),
      aThieleInnes: row.float('a_thiele_innes'),
      bThieleInnes: row.float('b_thiele_innes'),
      fThieleInnes: row.float('f_thiele_innes'),
      gThieleInnes: row.float('g_thiele_innes'),
      inclination: row.float('inclination'),
      argPeriastron: row.float('arg_periastron'),
      massRatio: row.float('mass_ratio'),
    });
  }
  return out;
}
