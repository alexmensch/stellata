// Row shape + TSV parser for `data/simbad/simbad_sample.tsv`, the
// stratified 10k SIMBAD cross-check sample. See
// /scripts/catalog/validate/README.md#validation-harness-1 (Tier C).
import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

/** Full-row view of the SIMBAD sample TSV — every field downstream
 *  consumers might want, with no joining or filtering applied.
 *  Distance-only consumers project to `SimbadDistanceEntry` via
 *  `simbadSampleDistances` (distance-regression-check.ts); the
 *  validate-simbad-sample script wants the wider surface (PM, absmag,
 *  parallax errors) for residual histograms. */
export interface SimbadSampleRow {
  simbadOid: number;
  simbadMainId: string;
  hip: number | null;
  gaiaSourceId: string | null;
  plxValue: number | null;
  plxErr: number | null;
  pmra: number | null;
  pmdec: number | null;
  vMag: number | null;
  distancePc: number | null;
  absmag: number | null;
}

const SIMBAD_SAMPLE_COLUMNS = [
  'simbad_oid', 'simbad_main_id', 'hip', 'gaia_source_id', 'plx_value',
  'plx_err', 'pmra', 'pmdec', 'v_mag', 'distance_pc', 'absmag',
] as const;

/** Sole TSV-parsing surface — single source of truth for column names,
 *  numeric coercion, and missing-value handling. An empty file throws rather
 *  than yielding zero rows: the sample gates the build's distance-regression
 *  check, so "no rows" must not read as "nothing to cross-check". */
export function parseSimbadSampleRows(text: string, from: Declared): SimbadSampleRow[] {
  const rows: SimbadSampleRow[] = [];
  for (const row of readTable({ ...from, columns: SIMBAD_SAMPLE_COLUMNS }, text)) {
    rows.push({
      simbadOid: row.int('simbad_oid') ?? row.fail('simbad_oid is empty'),
      simbadMainId: row.raw('simbad_main_id'),
      hip: row.int('hip'),
      gaiaSourceId: row.sourceId('gaia_source_id'),
      plxValue: row.float('plx_value'),
      plxErr: row.float('plx_err'),
      pmra: row.float('pmra'),
      pmdec: row.float('pmdec'),
      vMag: row.float('v_mag'),
      distancePc: row.float('distance_pc'),
      absmag: row.float('absmag'),
    });
  }
  return rows;
}
