// build/catalog-pair-ends.json: each multiples.tsv pair's rendered ends as records, and its codec. See README.md.

import { isRecordIndex, readMultiplesSha1 } from './catalog-row-index-map-pure';

/** A pair's two ends as record indices; null where an end addresses no record. */
export interface PairEnds {
  readonly primary: number | null;
  readonly secondary: number | null;
}

export interface CatalogPairEnds {
  readonly multiplesSha1: string;
  /** Keyed by multiples.tsv system_id. */
  readonly pairs: ReadonlyMap<string, PairEnds>;
}

export function serializeCatalogPairEnds(multiplesSha1: string, pairs: ReadonlyMap<string, PairEnds>): string {
  const cells = Object.fromEntries([...pairs].map(([systemId, e]) => [systemId, [e.primary, e.secondary]]));
  return JSON.stringify({ multiplesSha1, pairs: cells }) + '\n';
}

/** Throws on a missing sha1 or section, or a cell that is not two record indices or nulls. */
export function parseCatalogPairEnds(text: string): CatalogPairEnds {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const multiplesSha1 = readMultiplesSha1(raw, 'catalog pair ends');
  const value = raw.pairs;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('catalog pair ends: section pairs is missing');
  }
  const pairs = new Map<string, PairEnds>();
  for (const [systemId, cell] of Object.entries(value)) {
    if (!Array.isArray(cell) || cell.length !== 2 || !cell.every((v) => v === null || isRecordIndex(v))) {
      throw new Error(`catalog pair ends: pairs[${systemId}] is ${JSON.stringify(cell)}, not two record indices or nulls`);
    }
    pairs.set(systemId, { primary: cell[0], secondary: cell[1] });
  }
  return { multiplesSha1, pairs };
}
