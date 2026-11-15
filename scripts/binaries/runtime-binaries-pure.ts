// multiples.tsv + the catalogue row-index map → binaries.bin bytes. See README.md#runtime-side-artifact.

import {
  FLAG_HAS_INCLINATION, FLAG_HAS_ORBIT, FLAG_IS_INNER_OF_HIERARCHY, NO_PARENT, encodeBinaries,
  hasRenderableOrbit, type BinaryRecord,
} from '../../src/catalog-format/binaries/binaries-format';
import type { PairEnds } from '../catalog/companions/record-index/pair-ends-pure';
import { distinctEnds } from '../catalog/companions/record-index/pair-resolution-pure';
import { compoundContains, relatedHier } from './component-tokens-pure';
import {
  assignParentRelations, pairsFromRows, topologicalWalkOrder, type MultiplesPair, type PairRow,
} from './pairs-pure';
import type { Check } from '../util/emit-artifacts';

/** The snapshot `build-runtime-binaries-expected.json` pins, as its `encode` stage. */
export type RuntimeBinariesCounts = {
  pairs_total: number;
  pairs_with_orbit: number;
  pairs_with_inclination: number;
  pairs_inner_of_hierarchy: number;
};

/** What became of one pair: README.md#runtime-pairs-lineage. `kept` is the input index of the pair that won its relation. */
export type PairFate =
  | { readonly kind: 'emitted'; readonly primary: number; readonly secondary: number }
  | { readonly kind: 'primary-unresolved' | 'secondary-unresolved' | 'degenerate-idx' }
  | { readonly kind: 'same-relation-alias' | 'duplicate-relation'; readonly kept: number };

/** Two pairs colliding on one relation name the same physical link when, on
 *  each side, their tokens are equal, hierarchy-related or compound-contained
 *  (18025+4414 `AB` vs `Aa,B`). Disjoint letters on either side are two
 *  distinct stars collapsed onto one record (θ¹ Ori `Bb,Bc` vs `Ba,Bc`). */
export function sameRelationAlias(a: MultiplesPair, b: MultiplesPair): boolean {
  const alias = (x: string, y: string): boolean => relatedHier(x, y) || compoundContains(x, y);
  return alias(a.primaryComp, b.primaryComp) && alias(a.secondaryComp, b.secondaryComp);
}

type Addressed =
  | { readonly kind: 'primary-unresolved' | 'secondary-unresolved' | 'degenerate-idx' }
  | { readonly kind: 'distinct'; readonly primary: number; readonly secondary: number };

function addressed(ends: PairEnds): Addressed {
  if (distinctEnds(ends)) return { kind: 'distinct', primary: ends.primary, secondary: ends.secondary };
  if (ends.primary === null) return { kind: 'primary-unresolved' };
  return ends.secondary === null ? { kind: 'secondary-unresolved' } : { kind: 'degenerate-idx' };
}

function assertVisitsEachOnce(walkOrder: readonly number[], n: number): void {
  const seen = new Set(walkOrder.filter((i) => Number.isInteger(i) && i >= 0 && i < n));
  if (walkOrder.length !== n || seen.size !== n) {
    throw new Error(`planRecords: the walk must visit each of ${n} pairs once; it visits ${seen.size} of them in ${walkOrder.length} steps`);
  }
}

/** README.md#runtime-pairs-lineage. `parentRelation` is the parent's emitted position, not its input index. */
export function planRecords(
  pairs: readonly MultiplesPair[],
  parents: readonly number[],
  walkOrder: readonly number[],
  ends: readonly PairEnds[],
): { records: BinaryRecord[]; fates: PairFate[]; counts: RuntimeBinariesCounts } {
  assertVisitsEachOnce(walkOrder, pairs.length);
  const addresses = ends.map(addressed);
  const relationKey = (a: { primary: number; secondary: number }): string => `${a.primary},${a.secondary}`;
  const relationWinner = new Map<string, number>();
  for (const i of walkOrder) {
    const a = addresses[i];
    if (a.kind !== 'distinct') continue;
    const incumbent = relationWinner.get(relationKey(a));
    if (incumbent === undefined
      || (hasRenderableOrbit(pairs[i].elements) && !hasRenderableOrbit(pairs[incumbent].elements))) {
      relationWinner.set(relationKey(a), i);
    }
  }
  const fates = addresses.map((a, i): PairFate => {
    if (a.kind !== 'distinct') return a;
    const winner = relationWinner.get(relationKey(a)) as number;
    if (winner === i) return { kind: 'emitted', primary: a.primary, secondary: a.secondary };
    return { kind: sameRelationAlias(pairs[i], pairs[winner]) ? 'same-relation-alias' : 'duplicate-relation', kept: winner };
  });

  const counts: RuntimeBinariesCounts = {
    pairs_total: pairs.length, pairs_with_orbit: 0, pairs_with_inclination: 0, pairs_inner_of_hierarchy: 0,
  };
  const records: BinaryRecord[] = [];
  const inputToOutput = new Map<number, number>();
  for (const i of walkOrder) {
    const fate = fates[i];
    if (fate.kind !== 'emitted') continue;
    const { primary: primaryIdx, secondary: secondaryIdx } = fate;
    const p = pairs[i];
    const hasOrbit = hasRenderableOrbit(p.elements);
    const hasInclination = hasOrbit && p.elements.iRad !== null;
    const parentRelation = inputToOutput.get(parents[i]) ?? NO_PARENT;
    let flags = 0;
    if (hasOrbit) { flags |= FLAG_HAS_ORBIT; counts.pairs_with_orbit++; }
    if (hasInclination) { flags |= FLAG_HAS_INCLINATION; counts.pairs_with_inclination++; }
    if (parentRelation !== NO_PARENT) { flags |= FLAG_IS_INNER_OF_HIERARCHY; counts.pairs_inner_of_hierarchy++; }
    inputToOutput.set(i, records.length);
    records.push({ primaryIdx, secondaryIdx, flags, parentRelation, ...p.elements });
  }
  return { records, fates, counts };
}

/** Fails unless the pair ends were built from the multiples.tsv this run
 *  reads: against another copy, record indices resolve to the wrong stars. */
export function multiplesHandshake(builtFrom: string, reading: string): Check {
  return builtFrom === reading
    ? { kind: 'pass' }
    : {
        kind: 'fail',
        message: `the catalogue pair ends were built from multiples.tsv ${builtFrom}, `
          + `but this run reads ${reading}. Re-run \`pnpm run build:catalog\`.`,
      };
}

export interface RuntimeBinaries {
  readonly bytes: Uint8Array;
  readonly pairs: readonly MultiplesPair[];
  readonly fates: readonly PairFate[];
  readonly counts: RuntimeBinariesCounts;
  /** Pairs nested inside another, before any is dropped. */
  readonly nested: number;
}

/** See README.md#runtime-side-artifact. */
export function encodeRuntimeBinaries(
  rows: readonly PairRow[],
  pairEnds: ReadonlyMap<string, PairEnds>,
): RuntimeBinaries {
  const pairs = pairsFromRows(rows);
  const parents = assignParentRelations(pairs);
  const ends = pairs.map((p) => {
    const e = pairEnds.get(p.systemId);
    if (e === undefined) throw new Error(`catalog pair ends: no resolved ends for pair ${p.systemId}`);
    return e;
  });
  const { records, fates, counts } = planRecords(pairs, parents, topologicalWalkOrder(parents), ends);
  return { bytes: encodeBinaries(records), pairs, fates, counts, nested: parents.filter((p) => p !== NO_PARENT).length };
}
