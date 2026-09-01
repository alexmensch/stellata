// The records whose shipped distance came from the cascade's SIMBAD tier —
// § 5's validation-independence rule made checkable. See README.md § The skip
// rules, and ../../validate/README.md for the validator that reads it.

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

const COLUMNS = ['gaia_source_id', 'hip'] as const;

export function formatSimbadSourcedDistancesTsv(
  rows: readonly SimbadSourcedDistance[],
): string {
  const lines = [...rows]
    .map((r) => [r.gaiaSourceId ?? '', r.hip ?? ''].join('\t'))
    .sort();
  return [COLUMNS.join('\t'), ...lines].join('\n') + '\n';
}

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
  const [header, ...lines] = text.trimEnd().split('\n');
  if (header !== COLUMNS.join('\t')) {
    throw new Error(
      `${SIMBAD_SOURCED_DISTANCES_FILE}: unexpected header "${header}"`,
    );
  }
  const gaia = new Set<string>();
  const hip = new Set<number>();
  for (const line of lines) {
    if (line === '') continue;
    const [sourceId, hipCell] = line.split('\t');
    if (sourceId) gaia.add(sourceId);
    if (hipCell) hip.add(Number(hipCell));
  }
  return { gaia, hip };
}
