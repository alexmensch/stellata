// data/gaia/gaia_dr3_gspc.tsv → source_id → synthetic Johnson B−V.
// See README.md#the-ci-cascade.

import { readTable, type TableSpec } from '../../util/tsv/table-pure';

const GSPC = {
  file: 'data/gaia/gaia_dr3_gspc.tsv',
  columns: ['source_id', 'b_jkc_mag', 'b_jkc_flag', 'v_jkc_mag', 'v_jkc_flag'] as const,
  hint: 'Re-run `pnpm run refresh:gaia-gspc`.',
} satisfies TableSpec<string>;

/** `1` = the source's G and BP−RP lie where the JKC standardisation was
 *  validated (Montegriffo 2023 (/data/papers/index.md#montegriffo2023)
 *  Sect. 6.2). The archive states no polarity;
 *  `/data/gaia/README.md#the-gspc-validated-range-flag--1-means-in-range` carries the quote
 *  and the measured region. */
const FLAG_IN_VALIDATED_RANGE = '1';

export interface GspcColour {
  /** Johnson B − V, both bands integrated from the source's own BP/RP
   *  spectrum. */
  bMinusV: number;
  /** Whether the archive calls both bands inside the standardisation's
   *  validated range. Recorded rather than gated on — this catalogue is
   *  bright enough that it is almost never true, and the tier's real bound is
   *  the measured one (README.md#why-the-gspc-tier-does-not-gate-on-the-flag).
   * Its count is pinned so an upstream polarity flip surfaces. */
  inValidatedRange: boolean;
}

/** Rows with either band absent yield no colour and are skipped, so a
 *  present entry always carries a usable B−V. Keyed by the `source_id`
 *  string for the same > `Number.MAX_SAFE_INTEGER` reason every other Gaia
 *  side-table is. */
export function parseGspcTsv(text: string): Map<string, GspcColour> {
  const out = new Map<string, GspcColour>();
  for (const row of readTable(GSPC, text)) {
    const sourceId = row.text('source_id');
    if (sourceId === null) continue;
    const b = row.float('b_jkc_mag');
    const v = row.float('v_jkc_mag');
    if (b === null || v === null) continue;
    out.set(sourceId, {
      bMinusV: b - v,
      inValidatedRange:
        row.text('b_jkc_flag') === FLAG_IN_VALIDATED_RANGE &&
        row.text('v_jkc_flag') === FLAG_IN_VALIDATED_RANGE,
    });
  }
  return out;
}
