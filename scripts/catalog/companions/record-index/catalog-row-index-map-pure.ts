// The catalogue row-index map, how a multiples.tsv component resolves through it, and the sidecar's codec. See README.md.

import type { PairEnds } from './pair-resolution-pure';

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
  readonly pairs: ReadonlyMap<string, PairEnds>;
}

export function serializeCatalogRowIndexSidecar(
  multiplesSha1: string,
  map: CatalogRowIndexMap,
  pairs: ReadonlyMap<string, PairEnds>,
): string {
  const pairCells = Object.fromEntries([...pairs].map(([systemId, e]) => [systemId, [e.primary, e.secondary]]));
  return JSON.stringify({
    multiplesSha1, byGaia: map.byGaia, byHip: map.byHip, bySynth: map.bySynth, pairs: pairCells,
  }) + '\n';
}

const isRecordIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function parsePairs(value: unknown): Map<string, PairEnds> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('catalog row-index map: section pairs is missing');
  }
  const pairs = new Map<string, PairEnds>();
  for (const [systemId, cell] of Object.entries(value)) {
    if (!Array.isArray(cell) || cell.length !== 2 || !cell.every((v) => v === null || isRecordIndex(v))) {
      throw new Error(`catalog row-index map: pairs[${systemId}] is ${JSON.stringify(cell)}, not two record indices or nulls`);
    }
    pairs.set(systemId, { primary: cell[0], secondary: cell[1] });
  }
  return pairs;
}

/** Throws on a missing section or sha1, or an entry that is not a record index. */
export function parseCatalogRowIndexMap(text: string): CatalogRowIndexSidecar {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const { multiplesSha1 } = raw;
  if (typeof multiplesSha1 !== 'string' || !/^[0-9a-f]{40}$/.test(multiplesSha1)) {
    throw new Error(`catalog row-index map: multiplesSha1 is ${JSON.stringify(multiplesSha1)}, not a sha1`);
  }
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
  return {
    multiplesSha1, byGaia: section('byGaia'), byHip: section('byHip'), bySynth: section('bySynth'),
    pairs: parsePairs(raw.pairs),
  };
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
