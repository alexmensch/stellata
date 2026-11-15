// Each WDS system's tree of catalogue records, nested by component token, with records claimed by several WDS ids
// resolved first. See README.md#wds-trees.

import { angularSeparationArcsec, unitVectorFromRaDec, type UnitVector } from '../../../src/astro-core/equatorial-basis';
import { compareCodeUnits } from '../../../src/astro-core/order-pure';
import type { GroupNode, SystemNode } from '../../../src/catalog-format/system-membership/system-membership-format';
import {
  compoundContains, isComponentToken, isMoreCanonicalAnchor, parentComponentToken, relatedHier, tokenLetters,
} from '../../binaries/component-tokens-pure';
import type { MultiplesPair } from '../../binaries/pairs-pure';
import { wdsIdPosition } from '../../wds/wds-pure';
import type { PairEnds } from '../companions/record-index/pair-ends-pure';

/** A record claimed by several WDS ids leaves each whose own coordinates lie farther than this from it. */
export const WDS_IDENTITY_MAX_ARCMIN = 30;

export interface WdsPairEnds {
  readonly pair: Pick<MultiplesPair, 'wdsId' | 'primaryComp' | 'secondaryComp'>;
  readonly rendered: PairEnds;
}

export interface WdsTree {
  readonly wdsId: string;
  readonly root: GroupNode;
}

export type WdsTreeCounts = {
  /** Records claimed by several WDS ids that the identity gate left in one. */
  systemWdsIdentityGated: number;
  /** Records claimed by several WDS ids that the gate cannot place in exactly one, so in none. */
  systemWdsAmbiguous: number;
  /** Records one WDS system reaches under unrelated component tokens; placed at the most specific. */
  systemWdsTokenConflicts: number;
};

export function group(component: string | null, children: readonly SystemNode[]): GroupNode {
  return { kind: 'group', component, children };
}

/** Empty groups dropped and one-child groups replaced by the child; null when nothing is left. */
export function normalized(node: SystemNode): SystemNode | null {
  if (node.kind === 'record') return node;
  const children = node.children.map(normalized).filter((c): c is SystemNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return group(node.component, children);
}

/** Where a record standing for both ends of a pair sits: their nearest shared token, or the root (null). */
function sharedToken(a: string, b: string): string | null {
  if (!isComponentToken(a) || !isComponentToken(b)) return compoundContains(a, b) ? a : compoundContains(b, a) ? b : null;
  const ancestors = (t: string) => {
    const out: string[] = [];
    for (let p: string | null = t; p !== null; p = parentComponentToken(p)) out.push(p);
    return out;
  };
  const ofB = ancestors(b);
  return ancestors(a).find((t) => ofB.includes(t)) ?? null;
}

function tokenRank(a: string | null, b: string | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  const compound = (t: string) => (isComponentToken(t) ? 0 : 1);
  if (compound(a) !== compound(b)) return compound(a) - compound(b);
  if (a.length !== b.length) return b.length - a.length;
  return isMoreCanonicalAnchor(a, b) ? -1 : isMoreCanonicalAnchor(b, a) ? 1 : 0;
}

function related(a: string | null, b: string | null): boolean {
  return a === null || b === null || relatedHier(a, b) || compoundContains(a, b) || compoundContains(b, a);
}

function smallestEnclosingCompound(token: string, tokens: readonly string[]): string | null {
  const letters = tokenLetters(token);
  const enclosing = tokens.filter((c) => {
    if (c === token || isComponentToken(c)) return false;
    const outer = tokenLetters(c);
    return outer.size > letters.size && [...letters].every((l) => outer.has(l));
  });
  enclosing.sort((a, b) => tokenLetters(a).size - tokenLetters(b).size || compareCodeUnits(a, b));
  return enclosing[0] ?? null;
}

function parentToken(token: string, tokens: readonly string[], present: ReadonlySet<string>): string | null {
  if (isComponentToken(token)) {
    for (let p = parentComponentToken(token); p !== null; p = parentComponentToken(p)) if (present.has(p)) return p;
  }
  return smallestEnclosingCompound(token, tokens);
}

function systemTree(tokenRecords: ReadonlyMap<string | null, ReadonlySet<number>>, counts: WdsTreeCounts): SystemNode | null {
  const tokens = [...tokenRecords.keys()].filter((t): t is string => t !== null).sort(compareCodeUnits);
  const present = new Set(tokens);
  const recordTokens = new Map<number, (string | null)[]>();
  for (const [t, rs] of tokenRecords) for (const r of rs) recordTokens.set(r, [...(recordTokens.get(r) ?? []), t]);

  const leaves = new Map<string | null, number[]>();
  for (const [r, ts] of [...recordTokens].sort((a, b) => a[0] - b[0])) {
    const at = [...ts].sort(tokenRank)[0];
    if (ts.some((t) => !related(at, t))) counts.systemWdsTokenConflicts++;
    leaves.set(at, [...(leaves.get(at) ?? []), r]);
  }
  const children = new Map<string | null, string[]>();
  for (const t of tokens) {
    const p = parentToken(t, tokens, present);
    children.set(p, [...(children.get(p) ?? []), t]);
  }
  const node = (t: string | null): GroupNode => group(t, [
    ...(leaves.get(t) ?? []).map((record): SystemNode => ({ kind: 'record', record })),
    ...(children.get(t) ?? []).map(node),
  ]);
  return normalized(node(null));
}

/** Every WDS system with two or more records, in WDS-id order. `direction` is a record's unit vector from Sol. */
export function wdsTrees(
  pairs: readonly WdsPairEnds[],
  direction: (record: number) => UnitVector,
): { trees: WdsTree[]; counts: WdsTreeCounts } {
  const bySystem = new Map<string, Map<string | null, Set<number>>>();
  const claims = new Map<number, Set<string>>();
  for (const { pair, rendered } of pairs) {
    let tokens = bySystem.get(pair.wdsId);
    if (!tokens) bySystem.set(pair.wdsId, (tokens = new Map()));
    const tokenSet = (t: string | null) => {
      let set = tokens.get(t);
      if (!set) tokens.set(t, (set = new Set()));
      return set;
    };
    const ends = [[pair.primaryComp, rendered.primary], [pair.secondaryComp, rendered.secondary]] as const;
    const placed = rendered.primary !== null && rendered.primary === rendered.secondary
      ? [[sharedToken(pair.primaryComp, pair.secondaryComp), rendered.primary] as const]
      : ends;
    for (const [token] of ends) tokenSet(token);
    for (const [token, record] of placed) {
      if (record === null) continue;
      tokenSet(token).add(record);
      let ids = claims.get(record);
      if (!ids) claims.set(record, (ids = new Set()));
      ids.add(pair.wdsId);
    }
  }

  const counts: WdsTreeCounts = { systemWdsIdentityGated: 0, systemWdsAmbiguous: 0, systemWdsTokenConflicts: 0 };
  const evicted = new Map<string, Set<number>>();
  const evict = (wdsId: string, record: number) => evicted.set(wdsId, (evicted.get(wdsId) ?? new Set()).add(record));
  for (const [record, ids] of claims) {
    if (ids.size < 2) continue;
    const kept = [...ids].filter((id) => {
      const at = wdsIdPosition(id);
      return at === null
        || angularSeparationArcsec(direction(record), unitVectorFromRaDec(at.raDeg, at.decDeg)) <= WDS_IDENTITY_MAX_ARCMIN * 60;
    });
    for (const id of ids) if (!kept.includes(id)) evict(id, record);
    if (kept.length === 1) counts.systemWdsIdentityGated++;
    else {
      counts.systemWdsAmbiguous++;
      for (const id of kept) evict(id, record);
    }
  }

  const trees: WdsTree[] = [];
  for (const wdsId of [...bySystem.keys()].sort(compareCodeUnits)) {
    const gone = evicted.get(wdsId);
    const tokens = new Map([...bySystem.get(wdsId) ?? []].map(([t, rs]) => [t, new Set([...rs].filter((r) => !gone?.has(r)))]));
    const root = systemTree(tokens, counts);
    if (root?.kind === 'group') trees.push({ wdsId, root });
  }
  return { trees, counts };
}
