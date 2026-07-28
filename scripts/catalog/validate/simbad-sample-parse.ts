// Row shape + TSV parser for `data/simbad/simbad_sample.tsv`, the
// stratified 10k SIMBAD cross-check sample. See
// scripts/catalog/README.md § Validation harness (Tier C).
import { headerIndex } from '../parse/corpus-tsv';

/** Full-row view of the SIMBAD sample TSV — every field downstream
 *  consumers might want, with no joining or filtering applied.
 *  Distance-only consumers project to `SimbadDistanceEntry` via
 *  `parseSimbadSampleTsv` (distance-regression-check.ts); the
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

export function parseNumOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const SAMPLE_COLUMNS = [
  'simbad_oid', 'simbad_main_id', 'hip', 'gaia_source_id', 'plx_value',
  'plx_err', 'pmra', 'pmdec', 'v_mag', 'distance_pc', 'absmag',
] as const;

/** Sole TSV-parsing surface — single source of truth for column names,
 *  numeric coercion, and missing-value handling. An empty file throws rather
 *  than yielding zero rows: the sample gates the build's distance-regression
 *  check, so "no rows" must not read as "nothing to cross-check". */
export function parseSimbadSampleRows(text: string): SimbadSampleRow[] {
  const lines = text.split('\n');
  const idx = headerIndex(
    lines[0] ?? '',
    SAMPLE_COLUMNS,
    'simbad_sample.tsv',
    'Re-run scripts/refresh/refresh-simbad-sample.py.',
  );
  const rows: SimbadSampleRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');
    const hipRaw = cols[idx.hip];
    const gaiaRaw = cols[idx.gaia_source_id];
    rows.push({
      simbadOid: Number(cols[idx.simbad_oid]),
      simbadMainId: cols[idx.simbad_main_id] ?? '',
      hip: hipRaw ? Number(hipRaw) : null,
      gaiaSourceId: gaiaRaw || null,
      plxValue: parseNumOrNull(cols[idx.plx_value]),
      plxErr: parseNumOrNull(cols[idx.plx_err]),
      pmra: parseNumOrNull(cols[idx.pmra]),
      pmdec: parseNumOrNull(cols[idx.pmdec]),
      vMag: parseNumOrNull(cols[idx.v_mag]),
      distancePc: parseNumOrNull(cols[idx.distance_pc]),
      absmag: parseNumOrNull(cols[idx.absmag]),
    });
  }
  return rows;
}
