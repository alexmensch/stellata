// The catalogue row-index map, how a multiples.tsv component resolves through it, and the file's codec. See README.md.

export interface CatalogRowIndexMap {
  /** Gaia DR3 source_id (decimal string) → catalog.bin record index. */
  byGaia: Record<string, number>;
  /** Hipparcos catalog number → catalog.bin record index. */
  byHip: Record<string, number>;
  /** Synthetic identifier → catalog.bin record index
   *  (../README.md#companion-promotion-from-databinariesmultiplestsv). */
  bySynth: Record<string, number>;
}

/** README.md#the-sidecar-and-how-a-component-resolves. */
export interface CatalogRowIndexSidecar extends CatalogRowIndexMap {
  readonly multiplesSha1: string;
}

export function serializeCatalogRowIndexSidecar(multiplesSha1: string, map: CatalogRowIndexMap): string {
  return JSON.stringify({ multiplesSha1, byGaia: map.byGaia, byHip: map.byHip, bySynth: map.bySynth }) + '\n';
}

export const isRecordIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Throws unless a build/ hand-off's `multiplesSha1` is a sha1. */
export function readMultiplesSha1(raw: Record<string, unknown>, file: string): string {
  const { multiplesSha1 } = raw;
  if (typeof multiplesSha1 !== 'string' || !/^[0-9a-f]{40}$/.test(multiplesSha1)) {
    throw new Error(`${file}: multiplesSha1 is ${JSON.stringify(multiplesSha1)}, not a sha1`);
  }
  return multiplesSha1;
}

/** Throws on a missing section or sha1, or an entry that is not a record index. */
export function parseCatalogRowIndexMap(text: string): CatalogRowIndexSidecar {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const multiplesSha1 = readMultiplesSha1(raw, 'catalog row-index map');
  const section = (name: keyof CatalogRowIndexMap): Record<string, number> => {
    const value = raw[name];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`catalog row-index map: section ${name} is missing`);
    }
    for (const [key, idx] of Object.entries(value)) {
      if (!isRecordIndex(idx)) {
        throw new Error(`catalog row-index map: ${name}[${key}] is ${JSON.stringify(idx)}, not a record index`);
      }
    }
    return value as Record<string, number>;
  };
  return { multiplesSha1, byGaia: section('byGaia'), byHip: section('byHip'), bySynth: section('bySynth') };
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
