// multiples.tsv rows joined into physical pairs, each pair's parent pair and the outer-before-inner walk. See README.md.

import {
  NO_PARENT, hasRenderableOrbit, pickBinaryElements, type BinaryElementKey, type BinaryElements,
} from '../../src/catalog-format/binaries/binaries-format';
import { canonicalCompLetter, parentComponentToken, wdsRootOf } from './component-tokens-pure';
import type { MultiplesRecord } from './multiples-record-pure';
import { MULTIPLES_ROW_KEY } from './multiples-row-key-pure';
import { rowKeyText } from '../util/sources/row-ref-pure';

/** One physical pair: a system's primary and secondary rows joined. */
export interface MultiplesPair {
  readonly systemId: string;
  readonly wdsId: string;
  /** Its secondary row's key, the row that founds its companion: README.md#runtime-pairs-lineage. */
  readonly origin: string;
  readonly primaryComp: string;
  /** Canonical (`canonicalCompLetter`), so `Aa1,2`'s secondary is `Aa2`. */
  readonly secondaryComp: string;
  readonly primaryGaia: string | null;
  readonly primaryHip: number | null;
  readonly secondaryGaia: string | null;
  readonly secondaryHip: number | null;
  /** The primary row's. */
  readonly elements: BinaryElements;
}

/** The cells of a multiples.tsv row a pair is built from. */
export type PairRow = Pick<MultiplesRecord,
  'systemId' | 'comp' | 'orbitRole' | 'gaiaSourceId' | 'hip' | BinaryElementKey>;

export function pairsFromRows(rows: readonly PairRow[]): MultiplesPair[] {
  const primaries = new Map<string, PairRow>();
  const secondaries = new Map<string, PairRow>();
  for (const row of rows) {
    if (row.orbitRole === 'standalone') continue;
    const byRole = row.orbitRole === 'primary' ? primaries : secondaries;
    if (byRole.has(row.systemId)) {
      throw new Error(`multiples.tsv: system ${row.systemId} has two ${row.orbitRole} rows`);
    }
    byRole.set(row.systemId, row);
  }
  const pairs: MultiplesPair[] = [];
  for (const systemId of secondaries.keys()) {
    if (!primaries.has(systemId)) throw new Error(`multiples.tsv: system ${systemId} has no primary row`);
  }
  for (const [systemId, p] of primaries) {
    const s = secondaries.get(systemId);
    if (s === undefined) throw new Error(`multiples.tsv: system ${systemId} has no secondary row`);
    const wdsId = wdsRootOf(systemId);
    if (wdsId === null) throw new Error(`multiples.tsv: system ${systemId} names no WDS id`);
    const primaryComp = p.comp.trim();
    pairs.push({
      systemId,
      wdsId,
      origin: rowKeyText(MULTIPLES_ROW_KEY, s),
      primaryComp,
      secondaryComp: canonicalCompLetter(primaryComp, s.comp),
      primaryGaia: p.gaiaSourceId,
      primaryHip: p.hip,
      secondaryGaia: s.gaiaSourceId,
      secondaryHip: s.hip,
      elements: pickBinaryElements(p),
    });
  }
  return pairs;
}

function parentRank(pair: MultiplesPair): readonly [number, number] {
  return [hasRenderableOrbit(pair.elements) ? 0 : 1, pair.elements.sepArcsec ?? Infinity];
}

function ranksBefore(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

/** Each pair's parent: the best-ranked other pair of its WDS system that
 *  lists its primary token's parent (Algol Aa1,Aa2 → the pair naming Aa),
 *  else NO_PARENT. */
export function assignParentRelations(pairs: readonly MultiplesPair[]): number[] {
  const bySystem = new Map<string, Map<string, number[]>>();
  pairs.forEach((pair, i) => {
    let bucket = bySystem.get(pair.wdsId);
    if (!bucket) bySystem.set(pair.wdsId, (bucket = new Map()));
    for (const tok of [pair.primaryComp, pair.secondaryComp]) {
      const list = bucket.get(tok);
      if (list) list.push(i);
      else bucket.set(tok, [i]);
    }
  });

  return pairs.map((pair, i) => {
    const parentTok = parentComponentToken(pair.primaryComp);
    if (parentTok === null) return NO_PARENT;
    const candidates = (bySystem.get(pair.wdsId)?.get(parentTok) ?? []).filter((j) => j !== i);
    if (candidates.length === 0) return NO_PARENT;
    return candidates.reduce((best, j) =>
      (ranksBefore(parentRank(pairs[j]), parentRank(pairs[best])) ? j : best));
  });
}

/** Outer-before-inner: each root in input order, then its subtree depth
 *  first; pairs whose parent link points nowhere come last. */
export function topologicalWalkOrder(parents: readonly number[]): number[] {
  const children = new Map<number, number[]>();
  parents.forEach((p, i) => {
    if (p === NO_PARENT) return;
    const list = children.get(p);
    if (list) list.push(i);
    else children.set(p, [i]);
  });
  const order: number[] = [];
  const visited = new Array<boolean>(parents.length).fill(false);
  const visit = (i: number): void => {
    if (visited[i]) return;
    visited[i] = true;
    order.push(i);
    for (const c of children.get(i) ?? []) visit(c);
  };
  parents.forEach((p, i) => { if (p === NO_PARENT) visit(i); });
  parents.forEach((_, i) => visit(i));
  return order;
}
