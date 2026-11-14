// multiples.tsv + the catalogue row-index map → binaries.bin bytes. See README.md#runtime-side-artifact.

import {
  FLAG_HAS_INCLINATION, FLAG_HAS_ORBIT, FLAG_IS_INNER_OF_HIERARCHY, NO_PARENT, encodeBinaries,
  hasRenderableOrbit, type BinaryRecord,
} from '../../src/catalog-format/binaries/binaries-format';
import { distinctEnds, type PairEnds } from '../catalog/companions/record-index/pair-resolution-pure';
import { compoundContains, relatedHier } from './component-tokens-pure';
import {
  assignParentRelations, pairsFromRows, topologicalWalkOrder, type MultiplesPair, type PairRow,
} from './pairs-pure';
import type { Check } from '../util/emit-artifacts';

/** The snapshot `build-runtime-binaries-expected.json` pins, as its `encode` stage. */
export type RuntimeBinariesCounts = {
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
};

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

/** The records binaries.bin carries, in walk order, and the counts of what
 *  was dropped and flagged. `parentRelation` is the parent's emitted
 *  position, not its input index. */
export function planRecords(
  pairs: readonly MultiplesPair[],
  parents: readonly number[],
  walkOrder: readonly number[],
  ends: readonly PairEnds[],
): { records: BinaryRecord[]; counts: RuntimeBinariesCounts } {
  const relationKey = (i: number): string => `${ends[i].primary},${ends[i].secondary}`;
  const relationWinner = new Map<string, number>();
  for (const i of walkOrder) {
    if (!distinctEnds(ends[i])) continue;
    const incumbent = relationWinner.get(relationKey(i));
    if (incumbent === undefined
      || (hasRenderableOrbit(pairs[i].elements) && !hasRenderableOrbit(pairs[incumbent].elements))) {
      relationWinner.set(relationKey(i), i);
    }
  }

  const counts = emptyCounts(pairs.length);
  const records: BinaryRecord[] = [];
  const inputToOutput = new Map<number, number>();
  for (const i of walkOrder) {
    const { primary: primaryIdx, secondary: secondaryIdx } = ends[i];
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
  counts.pairs_emitted = records.length;
  return { records, counts };
}

/** Fails unless the row-index map was built from the multiples.tsv this run
 *  reads: against another copy, record indices resolve to the wrong stars. */
export function multiplesHandshake(builtFrom: string, reading: string): Check {
  return builtFrom === reading
    ? { kind: 'pass' }
    : {
        kind: 'fail',
        message: `the catalogue row-index map was built from multiples.tsv ${builtFrom}, `
          + `but this run reads ${reading}. Re-run \`pnpm run build:catalog\`.`,
      };
}

export interface RuntimeBinaries {
  readonly bytes: Uint8Array;
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
    if (e === undefined) throw new Error(`catalog row-index map: no resolved ends for pair ${p.systemId}`);
    return e;
  });
  const { records, counts } = planRecords(pairs, parents, topologicalWalkOrder(parents), ends);
  return { bytes: encodeBinaries(records), counts, nested: parents.filter((p) => p !== NO_PARENT).length };
}
