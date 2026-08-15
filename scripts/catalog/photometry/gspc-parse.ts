// data/gaia/gaia_dr3_gspc.tsv → source_id → synthetic Johnson B−V.
// See README.md § The ci cascade.

import { dataRows, parseFloatOrNull } from '../parse/corpus-tsv';

const GSPC_COLUMNS = [
  'source_id', 'b_jkc_mag', 'b_jkc_flag', 'v_jkc_mag', 'v_jkc_flag',
] as const;

/** The archive publishes `1` for a source inside the range the JKC
 *  standardisation was validated over. The polarity is measured, not
 *  published — `data/gaia/README.md` § The GSPC validated-range flag. */
const FLAG_IN_VALIDATED_RANGE = '1';

export interface GspcColour {
  /** Johnson B − V, both bands integrated from the source's own BP/RP
   *  spectrum. */
  bMinusV: number;
  /** Whether the archive calls both bands inside the standardisation's
   *  validated range. Recorded rather than gated on — this catalogue is
   *  bright enough that it is almost never true, and the tier's real bound is
   *  the measured one (README.md § Why the GSPC tier does not gate on the
   *  flag). Its count is pinned so an upstream polarity flip surfaces. */
  inValidatedRange: boolean;
}

/** Rows with either band absent yield no colour and are skipped, so a
 *  present entry always carries a usable B−V. Keyed by the `source_id`
 *  string for the same > `Number.MAX_SAFE_INTEGER` reason every other Gaia
 *  side-table is. */
export function parseGspcTsv(text: string): Map<string, GspcColour> {
  const out = new Map<string, GspcColour>();
  for (const { cells, idx } of dataRows(
    text, GSPC_COLUMNS, 'gaia_dr3_gspc.tsv', 'Re-run `pnpm run refresh:gaia-gspc`.',
  )) {
    const sourceId = (cells[idx.source_id] ?? '').trim();
    if (!sourceId) continue;
    const b = parseFloatOrNull(cells[idx.b_jkc_mag]);
    const v = parseFloatOrNull(cells[idx.v_jkc_mag]);
    if (b === null || v === null) continue;
    out.set(sourceId, {
      bMinusV: b - v,
      inValidatedRange:
        (cells[idx.b_jkc_flag] ?? '').trim() === FLAG_IN_VALIDATED_RANGE &&
        (cells[idx.v_jkc_flag] ?? '').trim() === FLAG_IN_VALIDATED_RANGE,
    });
  }
  return out;
}
