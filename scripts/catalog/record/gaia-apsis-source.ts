// Gaia DR3 Apsis astrophysical parameters, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import type { ApsisRow } from './catalog-pure';

const GAIA_APSIS_COLUMNS = [
  'source_id',
  'teff_gspphot', 'logg_gspphot', 'mh_gspphot', 'azero_gspphot',
  'teff_gspspec', 'logg_gspspec', 'mh_gspspec',
  'spectraltype_esphs',
] as const;

/** Parse the TSV produced by `scripts/refresh/refresh-gaia-apsis.py` into
 *  a Gaia DR3 source_id → ApsisRow map. `source_id` is kept as a string:
 *  Gaia source_ids exceed Number.MAX_SAFE_INTEGER so any numeric parse
 *  would silently corrupt the join key. Blank cells decode to `null` —
 *  the writer maps `null` to `NO_APSIS` (NaN) at pack time. */
export function parseGaiaApsisTsv(text: string, from: Declared): Map<string, ApsisRow> {
  const out = new Map<string, ApsisRow>();
  for (const row of readTable({ ...from, columns: GAIA_APSIS_COLUMNS }, text)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId === null) continue;
    out.set(sourceId, {
      teffGspphot: row.float('teff_gspphot'),
      loggGspphot: row.float('logg_gspphot'),
      mhGspphot: row.float('mh_gspphot'),
      azeroGspphot: row.float('azero_gspphot'),
      teffGspspec: row.float('teff_gspspec'),
      loggGspspec: row.float('logg_gspspec'),
      mhGspspec: row.float('mh_gspspec'),
      spectraltypeEsphs: row.text('spectraltype_esphs'),
    });
  }
  return out;
}

export const GAIA_APSIS = defineSource({
  file: 'data/gaia/gaia_dr3_apsis.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-apsis`.',
  parse: (input) => parseGaiaApsisTsv(input.text(), input),
});
