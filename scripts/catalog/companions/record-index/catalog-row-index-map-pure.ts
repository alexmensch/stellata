// The catalogue row-index map and how a multiples.tsv component resolves through it. See README.md.

export interface CatalogRowIndexMap {
  /** Gaia DR3 source_id (decimal string) → catalog.bin record index. */
  byGaia: Record<string, number>;
  /** Hipparcos catalog number → catalog.bin record index. */
  byHip: Record<string, number>;
  /** Synthetic identifier → catalog.bin record index
   *  (../README.md#companion-promotion-from-databinariesmultiplestsv). */
  bySynth: Record<string, number>;
}

export function parseCatalogRowIndexMap(text: string): CatalogRowIndexMap {
  const raw = JSON.parse(text) as Partial<CatalogRowIndexMap>;
  return { byGaia: raw.byGaia ?? {}, byHip: raw.byHip ?? {}, bySynth: raw.bySynth ?? {} };
}

/** gaia → hip → synth, the first section that holds the component's key. */
export function resolveMultiplesIdx(
  gaia: string | null,
  hip: number | null,
  synthKey: string | null,
  rowIndexMap: CatalogRowIndexMap,
): number | null {
  if (gaia) {
    const hit = rowIndexMap.byGaia[gaia];
    if (hit !== undefined) return hit;
  }
  if (hip !== null && hip > 0) {
    const hit = rowIndexMap.byHip[`${hip}`];
    if (hit !== undefined) return hit;
  }
  if (synthKey !== null) {
    const hit = rowIndexMap.bySynth[synthKey];
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The record a component's synth key addresses, or null when none exists or
 *  it is `exclude`. Promotion mints a synth record only for a row whose ids it
 *  judged inherited and stripped, so a hit is the truer slot than an id-first
 *  resolve that blended onto another member's record. */
export function synthSlotIdx(
  synthKey: string | null,
  rowIndexMap: CatalogRowIndexMap,
  exclude: number | null = null,
): number | null {
  if (synthKey === null) return null;
  const hit = rowIndexMap.bySynth[synthKey];
  return hit === undefined || hit === exclude ? null : hit;
}
