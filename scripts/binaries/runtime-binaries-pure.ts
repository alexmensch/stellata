// multiples.tsv + the catalogue row-index map → binaries.bin bytes. See README.md#runtime-side-artifact.

import {
  FLAG_HAS_INCLINATION, FLAG_HAS_ORBIT, FLAG_IS_INNER_OF_HIERARCHY, NO_PARENT, encodeBinaries,
  hasRenderableOrbit, type BinaryRecord,
} from '../../src/catalog-format/binaries/binaries-format';
import {
  resolveMultiplesIdx, synthSlotIdx, type CatalogRowIndexMap,
} from '../catalog/companions/record-index/catalog-row-index-map-pure';
import {
  canonicalCompLetter, composeSyntheticId, compoundContains, parentComponentToken, relatedHier,
  splitComponents,
} from './component-tokens-pure';
import type { MultiplesRecord } from './multiples-tsv';

/** One physical pair: a system's primary and secondary rows joined. Elements
 *  and WDS geometry are the primary row's. */
export interface MultiplesPair {
  readonly systemId: string;
  readonly components: string;
  readonly primaryComp: string;
  /** Canonical (`canonicalCompLetter`), so `Aa1,2`'s secondary is `Aa2`. */
  readonly secondaryComp: string;
  readonly primaryGaia: string | null;
  readonly primaryHip: number | null;
  readonly secondaryGaia: string | null;
  readonly secondaryHip: number | null;
  readonly pDays: number | null;
  readonly tJd: number | null;
  readonly e: number | null;
  readonly aAU: number | null;
  readonly iRad: number | null;
  readonly omegaRad: number | null;
  readonly OmegaRad: number | null;
  readonly q: number | null;
  readonly sepArcsec: number | null;
  readonly paDeg: number | null;
  readonly sepPaEpochJd: number | null;
}

/** The snapshot `build-runtime-binaries-expected.json` pins. */
export interface RuntimeBinariesCounts {
  pairs_total: number;
  pairs_emitted: number;
  pairs_dropped_primary_unresolved: number;
  pairs_dropped_secondary_unresolved: number;
  pairs_dropped_degenerate_idx: number;
  pairs_dropped_same_relation_alias: number;
  pairs_dropped_duplicate_relation: number;
  pairs_with_orbit: number;
  pairs_with_inclination: number;
  pairs_inner_of_hierarchy: number;
}

/** The cells of a multiples.tsv row a pair is built from. */
export type PairRow = Pick<MultiplesRecord,
  | 'systemId' | 'comp' | 'orbitRole' | 'gaiaSourceId' | 'hip'
  | 'pDays' | 'tJd' | 'e' | 'aAU' | 'iRad' | 'omegaRad' | 'OmegaRad' | 'q'
  | 'sepArcsec' | 'paDeg' | 'sepPaEpochJd'>;

/** Joins each system's primary and secondary rows; a system missing either,
 *  or whose system_id has no WDS id, is skipped, as are standalone rows. A
 *  system with two rows in one role throws. */
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
  for (const [systemId, p] of primaries) {
    const s = secondaries.get(systemId);
    if (s === undefined) continue;
    const dash = systemId.lastIndexOf('-');
    if (dash < 0) continue;
    const primaryComp = p.comp.trim();
    pairs.push({
      systemId,
      components: systemId.slice(dash + 1),
      primaryComp,
      secondaryComp: canonicalCompLetter(primaryComp, s.comp),
      primaryGaia: p.gaiaSourceId,
      primaryHip: p.hip,
      secondaryGaia: s.gaiaSourceId,
      secondaryHip: s.hip,
      pDays: p.pDays,
      tJd: p.tJd,
      e: p.e,
      aAU: p.aAU,
      iRad: p.iRad,
      omegaRad: p.omegaRad,
      OmegaRad: p.OmegaRad,
      q: p.q,
      sepArcsec: p.sepArcsec,
      paDeg: p.paDeg,
      sepPaEpochJd: p.sepPaEpochJd,
    });
  }
  return pairs;
}

function wdsIdOf(pair: MultiplesPair): string {
  return pair.systemId.slice(0, pair.systemId.lastIndexOf('-'));
}

/** The pair's two component tokens, the secondary re-anchored (`Aa1,2` → Aa1, Aa2). */
function pairTokens(pair: MultiplesPair): readonly [string, string] | null {
  const toks = splitComponents(pair.components);
  return toks === null ? null : [toks[0], canonicalCompLetter(toks[0], toks[1])];
}

function parentRank(pair: MultiplesPair): readonly [number, number] {
  return [hasRenderableOrbit(pair) ? 0 : 1, pair.sepArcsec ?? Infinity];
}

function ranksBefore(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

/** Each pair's parent: the best-ranked other pair of its WDS system that
 *  lists its primary token's parent (Algol Aa1,Aa2 → the pair naming Aa),
 *  else NO_PARENT. */
export function assignParentRelations(pairs: readonly MultiplesPair[]): number[] {
  const bySystem = new Map<string, Map<string, number[]>>();
  const tokens = pairs.map(pairTokens);
  pairs.forEach((pair, i) => {
    const toks = tokens[i];
    if (toks === null) return;
    const wds = wdsIdOf(pair);
    let bucket = bySystem.get(wds);
    if (!bucket) bySystem.set(wds, (bucket = new Map()));
    for (const tok of toks) {
      const list = bucket.get(tok);
      if (list) list.push(i);
      else bucket.set(tok, [i]);
    }
  });

  return pairs.map((pair, i) => {
    const toks = tokens[i];
    if (toks === null) return NO_PARENT;
    const parentTok = parentComponentToken(toks[0]);
    if (parentTok === null) return NO_PARENT;
    const candidates = (bySystem.get(wdsIdOf(pair))?.get(parentTok) ?? []).filter((j) => j !== i);
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

/** Re-homes each inner pair's primary onto its parent component's slot — the
 *  shared-slot invariant the runtime walk rides
 *  (/src/client/binaries/README.md#hierarchical-walk). Castor Ba carries A's
 *  blended source, so its own resolve lands on A's record; AB already
 *  resolved B. Walked outer-first so a deeper nest inherits its parent's
 *  corrected slot. Mutates `resolvedPrimary`. */
export function overrideInnerPrimaryIndices(
  pairs: readonly MultiplesPair[],
  parents: readonly number[],
  walkOrder: readonly number[],
  resolvedPrimary: (number | null)[],
  resolvedSecondary: readonly (number | null)[],
): void {
  for (const i of walkOrder) {
    const parentI = parents[i];
    if (parentI === NO_PARENT) continue;
    const parentTok = parentComponentToken(pairs[i].primaryComp);
    if (parentTok === null) continue;
    const pp = pairs[parentI];
    let slot: number | null;
    if (pp.primaryComp === parentTok) slot = resolvedPrimary[parentI];
    else if (pp.secondaryComp === parentTok) slot = resolvedSecondary[parentI];
    else continue;
    if (slot !== null) resolvedPrimary[i] = slot;
  }
}

/** Two pairs colliding on one relation name the same physical link when, on
 *  each side, their tokens are equal, hierarchy-related or compound-contained
 *  (18025+4414 `AB` vs `Aa,B`). Disjoint letters on either side are two
 *  distinct stars collapsed onto one record (θ¹ Ori `Bb,Bc` vs `Ba,Bc`). */
export function sameRelationAlias(a: MultiplesPair, b: MultiplesPair): boolean {
  const alias = (x: string, y: string): boolean => relatedHier(x, y) || compoundContains(x, y);
  return alias(a.primaryComp, b.primaryComp) && alias(a.secondaryComp, b.secondaryComp);
}

function emptyCounts(total: number): RuntimeBinariesCounts {
  return {
    pairs_total: total,
    pairs_emitted: 0,
    pairs_dropped_primary_unresolved: 0,
    pairs_dropped_secondary_unresolved: 0,
    pairs_dropped_degenerate_idx: 0,
    pairs_dropped_same_relation_alias: 0,
    pairs_dropped_duplicate_relation: 0,
    pairs_with_orbit: 0,
    pairs_with_inclination: 0,
    pairs_inner_of_hierarchy: 0,
  };
}

/** Both ends of a pair as records: gaia → hip → synth, then each end's own
 *  synth record when that is a different one. */
function resolvePairEnds(
  p: MultiplesPair,
  map: CatalogRowIndexMap,
): { primary: number | null; secondary: number | null } {
  const end = (gaia: string | null, hip: number | null, comp: string): number | null => {
    const synth = composeSyntheticId(p.systemId, comp);
    const id = resolveMultiplesIdx(gaia, hip, synth, map);
    return id === null ? null : synthSlotIdx(synth, map, id) ?? id;
  };
  return {
    primary: end(p.primaryGaia, p.primaryHip, p.primaryComp),
    secondary: end(p.secondaryGaia, p.secondaryHip, p.secondaryComp),
  };
}

/** The records binaries.bin carries, in walk order, and the counts of what
 *  was dropped and flagged. `parentRelation` is the parent's emitted
 *  position, not its input index. */
export function planRecords(
  pairs: readonly MultiplesPair[],
  parents: readonly number[],
  walkOrder: readonly number[],
  map: CatalogRowIndexMap,
): { records: BinaryRecord[]; counts: RuntimeBinariesCounts } {
  const resolvedPrimary: (number | null)[] = [];
  const resolvedSecondary: (number | null)[] = [];
  for (const p of pairs) {
    const { primary, secondary } = resolvePairEnds(p, map);
    resolvedPrimary.push(primary);
    resolvedSecondary.push(secondary);
  }
  overrideInnerPrimaryIndices(pairs, parents, walkOrder, resolvedPrimary, resolvedSecondary);

  const relationKey = (i: number): string => `${resolvedPrimary[i]},${resolvedSecondary[i]}`;
  const relationWinner = new Map<string, number>();
  for (const i of walkOrder) {
    if (resolvedPrimary[i] === null || resolvedSecondary[i] === null) continue;
    if (resolvedPrimary[i] === resolvedSecondary[i]) continue;
    const incumbent = relationWinner.get(relationKey(i));
    if (incumbent === undefined
      || (hasRenderableOrbit(pairs[i]) && !hasRenderableOrbit(pairs[incumbent]))) {
      relationWinner.set(relationKey(i), i);
    }
  }

  const counts = emptyCounts(pairs.length);
  const records: BinaryRecord[] = [];
  const inputToOutput = new Map<number, number>();
  for (const i of walkOrder) {
    const primaryIdx = resolvedPrimary[i];
    const secondaryIdx = resolvedSecondary[i];
    if (primaryIdx === null) { counts.pairs_dropped_primary_unresolved++; continue; }
    if (secondaryIdx === null) { counts.pairs_dropped_secondary_unresolved++; continue; }
    if (primaryIdx === secondaryIdx) { counts.pairs_dropped_degenerate_idx++; continue; }
    const winner = relationWinner.get(relationKey(i)) as number;
    if (winner !== i) {
      if (sameRelationAlias(pairs[i], pairs[winner])) counts.pairs_dropped_same_relation_alias++;
      else counts.pairs_dropped_duplicate_relation++;
      continue;
    }
    const p = pairs[i];
    const hasOrbit = hasRenderableOrbit(p);
    const hasInclination = hasOrbit && p.iRad !== null;
    const parentRelation = inputToOutput.get(parents[i]) ?? NO_PARENT;
    let flags = 0;
    if (hasOrbit) { flags |= FLAG_HAS_ORBIT; counts.pairs_with_orbit++; }
    if (hasInclination) { flags |= FLAG_HAS_INCLINATION; counts.pairs_with_inclination++; }
    if (parentRelation !== NO_PARENT) { flags |= FLAG_IS_INNER_OF_HIERARCHY; counts.pairs_inner_of_hierarchy++; }
    inputToOutput.set(i, records.length);
    records.push({
      primaryIdx, secondaryIdx, flags, parentRelation,
      pDays: p.pDays, tJd: p.tJd, e: p.e, aAU: p.aAU, iRad: p.iRad,
      omegaRad: p.omegaRad, OmegaRad: p.OmegaRad, q: p.q,
      sepArcsec: p.sepArcsec, paDeg: p.paDeg, sepPaEpochJd: p.sepPaEpochJd,
    });
  }
  counts.pairs_emitted = records.length;
  return { records, counts };
}

export interface RuntimeBinaries {
  readonly bytes: Uint8Array;
  readonly counts: RuntimeBinariesCounts;
  /** Pairs nested inside another, before any is dropped. */
  readonly nested: number;
}

export function encodeRuntimeBinaries(
  rows: readonly PairRow[],
  map: CatalogRowIndexMap,
): RuntimeBinaries {
  const pairs = pairsFromRows(rows);
  const parents = assignParentRelations(pairs);
  const { records, counts } = planRecords(pairs, parents, topologicalWalkOrder(parents), map);
  return { bytes: encodeBinaries(records), counts, nested: parents.filter((p) => p !== NO_PARENT).length };
}
