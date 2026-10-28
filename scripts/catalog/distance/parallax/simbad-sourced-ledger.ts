// The records whose shipped distance came from the cascade's SIMBAD tier —
// /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers's validation-independence rule made checkable. See README.md#the-skip-rules--one-principle-two-publications
// and ../../validate/README.md for the validator that reads it.

import { defineArtifact, nullableCell } from '../../../util/tsv/artifact-pure';

/** Where the exclusion list is committed. */
export const SIMBAD_SOURCED_DISTANCES_FILE =
  'data/athyg/simbad_sourced_distances.tsv';

/** One record on the `simbad_plx` tier, by the two identifiers a SIMBAD-based
 *  validator joins on. Both are emitted where the record carries both, since
 *  the validator falls back from one to the other. */
export interface SimbadSourcedDistance {
  gaiaSourceId: string | null;
  hip: number | null;
}

export const SIMBAD_SOURCED_DISTANCES = defineArtifact({
  file: SIMBAD_SOURCED_DISTANCES_FILE,
  columns: ['gaia_source_id', 'hip'] as const,
  hint: 'Re-run `pnpm run build:catalog`.',
  order: 'by-line',
  decode: (row): SimbadSourcedDistance => ({ gaiaSourceId: row.text('gaia_source_id'), hip: row.int('hip') }),
  encode: (r: SimbadSourcedDistance) => ({
    gaia_source_id: nullableCell(r.gaiaSourceId), hip: nullableCell(r.hip),
  }),
});

/** The two key sets a validator excludes on. Kept apart rather than folded
 *  into one string key: the validator resolves a sample row to a record by
 *  source_id OR by HIP, and either route can land on an excluded record. */
export interface SimbadSourcedKeys {
  gaia: ReadonlySet<string>;
  hip: ReadonlySet<number>;
}

export function emptySimbadSourcedKeys(): SimbadSourcedKeys {
  return { gaia: new Set(), hip: new Set() };
}

export function parseSimbadSourcedDistancesTsv(text: string): SimbadSourcedKeys {
  const gaia = new Set<string>();
  const hip = new Set<number>();
  for (const r of SIMBAD_SOURCED_DISTANCES.rows(text)) {
    if (r.gaiaSourceId !== null) gaia.add(r.gaiaSourceId);
    if (r.hip !== null) hip.add(r.hip);
  }
  return { gaia, hip };
}
