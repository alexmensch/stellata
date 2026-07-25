// Row shape + TSV parser for `data/simbad/simbad_sample.tsv`, the
// stratified 10k SIMBAD cross-check sample. See
// scripts/catalog/README.md § Validation harness (Tier C).

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

/** Sole TSV-parsing surface — single source of truth for column names,
 *  numeric coercion, and missing-value handling. */
export function parseSimbadSampleRows(text: string): SimbadSampleRow[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) {
      throw new Error(`simbad_sample.tsv missing required column: ${name}`);
    }
    return idx;
  };
  const cOid = col('simbad_oid');
  const cMainId = col('simbad_main_id');
  const cHip = col('hip');
  const cGaia = col('gaia_source_id');
  const cPlxValue = col('plx_value');
  const cPlxErr = col('plx_err');
  const cPmra = col('pmra');
  const cPmdec = col('pmdec');
  const cVmag = col('v_mag');
  const cDist = col('distance_pc');
  const cAbsmag = col('absmag');
  const rows: SimbadSampleRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');
    const hipRaw = cols[cHip];
    const gaiaRaw = cols[cGaia];
    rows.push({
      simbadOid: Number(cols[cOid]),
      simbadMainId: cols[cMainId] ?? '',
      hip: hipRaw ? Number(hipRaw) : null,
      gaiaSourceId: gaiaRaw || null,
      plxValue: parseNumOrNull(cols[cPlxValue]),
      plxErr: parseNumOrNull(cols[cPlxErr]),
      pmra: parseNumOrNull(cols[cPmra]),
      pmdec: parseNumOrNull(cols[cPmdec]),
      vMag: parseNumOrNull(cols[cVmag]),
      distancePc: parseNumOrNull(cols[cDist]),
      absmag: parseNumOrNull(cols[cAbsmag]),
    });
  }
  return rows;
}
