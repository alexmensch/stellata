// The sibling-identity guard: a HIP another, hierarchy-disjoint letter of the system already binds is not ours. See README.md.

import { compoundContains, relatedHier, tokenLetters } from '../component-tokens-pure';
import type { ResolvedComponent } from './components-pure';

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
