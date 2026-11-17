// The sibling-identity guards: a HIP another, hierarchy-disjoint letter of the system binds, or whose star it holds, is not ours. See README.md.

import { compoundContains, relatedHier, tokenLetters, type ComponentKey } from '../component-tokens-pure';
import { sourceForHip, type IdentifierIndices } from '../load/indices-pure';
import type { SimbadWdsXid } from '../load/simbad-pure';
import { groupBy } from '../../util/map-buckets-pure';
import { splitComponents, type Orb6Entry } from '../../wds/wds-pure';
import type { CascadeRefusal } from './cascade-pure';
import { componentSides, working, type DecomposedPair, type ResolvedComponent } from './components-pure';

/** wds_id → HIP → the letter tokens bound to it. */
export type HipClaims = Map<string, Map<number, Set<string>>>;

/** Equal, hierarchy-related or compound-contained: tokens that may share one identity. */
export function tokensShareIdentity(a: string, b: string): boolean {
  return relatedHier(a, b) || compoundContains(a, b);
}

/** A token with no capital (WDS's prefix-truncated digit form) carries no lineage and claims nothing. */
export function claimHip(claims: HipClaims, wdsId: string, hip: number, token: string): void {
  if (tokenLetters(token).size === 0) return;
  let byHip = claims.get(wdsId);
  if (!byHip) claims.set(wdsId, (byHip = new Map()));
  let tokens = byHip.get(hip);
  if (!tokens) byHip.set(hip, (tokens = new Set()));
  tokens.add(token);
}

export function buildSystemHipClaims(components: readonly ResolvedComponent[]): HipClaims {
  const claims: HipClaims = new Map();
  for (const c of components) if (c.hip !== null) claimHip(claims, c.wdsId, c.hip.value, c.component);
  return claims;
}

export function hipClaimedByDisjointLetter(
  claims: HipClaims, wdsId: string, hip: number, token: string, partnerToken: string | null,
): boolean {
  const claimants = claims.get(wdsId)?.get(hip);
  if (!claimants || claimants.size === 0) return false;
  for (const tok of claimants) {
    if (tokensShareIdentity(tok, token)) return false;
    if (partnerToken !== null && tokensShareIdentity(tok, partnerToken)) return false;
  }
  return true;
}

/** A letter a curated source names a HIP on: a SIMBAD cross-ID's component, an ORB6 row's primary. */
interface HipAttestation {
  readonly wdsId: string;
  readonly token: string;
  readonly hip: number;
}

function hipAttestations(
  xids: ReadonlyMap<ComponentKey, SimbadWdsXid>, orb6: readonly Orb6Entry[],
): ReadonlyMap<string, readonly HipAttestation[]> {
  const all: HipAttestation[] = [];
  for (const x of xids.values()) if (x.hip !== null) all.push({ wdsId: x.wdsId, token: x.component, hip: x.hip });
  for (const e of orb6) {
    if (e.hip === null) continue;
    const tokens = splitComponents(e.components);
    if (tokens !== null) all.push({ wdsId: e.wdsId, token: tokens[0], hip: e.hip });
  }
  return groupBy(all, (a) => a.wdsId);
}

/** Runs after the audit's enforcement: README.md#a-hip-follows-its-star */
export function refuseHipsOfDisjointStars(
  pairs: readonly DecomposedPair[], indices: Pick<IdentifierIndices, 'hipToGaia' | 'hipToManifestGaia'>,
  xids: ReadonlyMap<ComponentKey, SimbadWdsXid>, orb6: readonly Orb6Entry[],
): { pairs: readonly DecomposedPair[]; refused: readonly CascadeRefusal[] } {
  const holders = new Map<string, Map<string, string[]>>();
  for (const c of componentSides(pairs).map((s) => s.component)) {
    if (c.gaia === null) continue;
    let bySource = holders.get(c.wdsId);
    if (!bySource) holders.set(c.wdsId, (bySource = new Map()));
    bySource.set(c.gaia.value, [...(bySource.get(c.gaia.value) ?? []), c.component]);
  }
  const attested = hipAttestations(xids, orb6);
  const w = working(pairs);
  const refused: CascadeRefusal[] = [];
  for (const p of w.pairs) {
    for (const c of [p.primary, p.secondary]) {
      if (c.hip === null || c.gaia === null) continue;
      const hip = c.hip.value;
      const source = sourceForHip(hip, indices);
      if (source === null || source === c.gaia.value) continue;
      const holderTokens = holders.get(c.wdsId)?.get(source) ?? [];
      if (!holderTokens.some((t) => !tokensShareIdentity(t, c.component))) continue;
      if ((attested.get(c.wdsId) ?? []).some((a) => a.hip === hip && relatedHier(a.token, c.component))) continue;
      c.hip = null;
      refused.push({ gate: 'hip_of_disjoint_star', pair: p.pair, component: c.component, hip });
    }
  }
  return { pairs: w.pairs, refused };
}
