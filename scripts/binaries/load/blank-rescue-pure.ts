// The blank-components rescue: a blank WDS row an ORB6 orbit or a SIMBAD cross-ID confirms becomes its implied AB pair. README.md#blank-components-rescue.

import { discovererKey, type DiscovererKey } from '../component-tokens-pure';
import type { Orb6Entry, WdsPair } from '../../wds/wds-pure';

/** WDS's blank `components` is the implied single pair of a one-pair system. */
export const IMPLIED_AB_COMPONENTS = 'AB';

export const BLANK_RESCUE_OUTCOMES = ['rescued', 'deferred', 'donor', 'enumerated'] as const;
export type BlankRescueOutcome = (typeof BLANK_RESCUE_OUTCOMES)[number];

export type BlankRescueDecision =
  | { readonly row: WdsPair; readonly outcome: Exclude<BlankRescueOutcome, 'donor'> }
  | { readonly row: WdsPair; readonly outcome: 'donor'; readonly donatedTo: readonly WdsPair[] };

export interface BlankRescue {
  readonly pairs: readonly WdsPair[];
  readonly orb6: readonly Orb6Entry[];
  /** One per blank-components row, in file order. */
  readonly decisions: readonly BlankRescueDecision[];
}

/** Rescues the high-confidence subset — an ORB6 orbit for the same wds_id
 *  (Antares), or any SIMBAD WDS cross-ID for the system. The position-only
 *  remainder is deferred to the full blank → AB ingest. */
export function rescueBlankComponents(
  pairs: readonly WdsPair[],
  orb6: readonly Orb6Entry[],
  simbadWdsIds: ReadonlySet<string>,
  synthesizedOrb6Pairs: readonly WdsPair[],
): BlankRescue {
  const donees = new Map<DiscovererKey, WdsPair[]>();
  for (const p of synthesizedOrb6Pairs) {
    const key = discovererKey(p.wdsId, p.discoverer);
    donees.set(key, [...(donees.get(key) ?? []), p]);
  }
  const orb6WdsIds = new Set(orb6.map((e) => e.wdsId));
  const enumerated = new Set(pairs.filter((p) => p.components === IMPLIED_AB_COMPONENTS).map((p) => p.wdsId));

  const rescuedWdsIds = new Set<string>();
  const decisions: BlankRescueDecision[] = [];
  const decide = (row: WdsPair): BlankRescueDecision => {
    const donatedTo = donees.get(discovererKey(row.wdsId, row.discoverer));
    if (donatedTo !== undefined) return { row, outcome: 'donor', donatedTo };
    if (enumerated.has(row.wdsId) || rescuedWdsIds.has(row.wdsId)) return { row, outcome: 'enumerated' };
    return { row, outcome: orb6WdsIds.has(row.wdsId) || simbadWdsIds.has(row.wdsId) ? 'rescued' : 'deferred' };
  };
  const rescuedPairs = pairs.map((p) => {
    if (p.components !== '') return p;
    const decision = decide(p);
    decisions.push(decision);
    if (decision.outcome !== 'rescued') return p;
    rescuedWdsIds.add(p.wdsId);
    return { ...p, components: IMPLIED_AB_COMPONENTS };
  });
  const alignedOrb6 = orb6.map((e) => (
    e.components === '' && rescuedWdsIds.has(e.wdsId) ? { ...e, components: IMPLIED_AB_COMPONENTS } : e
  ));
  return { pairs: rescuedPairs, orb6: alignedOrb6, decisions };
}
