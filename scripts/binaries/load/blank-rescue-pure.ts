// The blank-components rescue: a blank WDS row an ORB6 orbit or a SIMBAD cross-ID confirms becomes its implied AB pair. README.md#blank-components-rescue.

import { discovererKey } from '../component-tokens-pure';
import type { Orb6Entry, WdsPair } from '../../wds/wds-pure';

/** WDS's blank `components` is the implied single pair of a one-pair system. */
export const IMPLIED_AB_COMPONENTS = 'AB';

export const BLANK_RESCUE_OUTCOMES = ['rescued', 'deferred', 'donor', 'enumerated'] as const;
export type BlankRescueOutcome = (typeof BLANK_RESCUE_OUTCOMES)[number];

export interface BlankRescue {
  readonly pairs: readonly WdsPair[];
  readonly orb6: readonly Orb6Entry[];
  /** One per blank-components row, in file order. */
  readonly outcomes: readonly BlankRescueOutcome[];
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
  const donorKeys = new Set(synthesizedOrb6Pairs.map((p) => discovererKey(p.wdsId, p.discoverer)));
  const orb6WdsIds = new Set(orb6.map((e) => e.wdsId));
  const enumerated = new Set(pairs.filter((p) => p.components === IMPLIED_AB_COMPONENTS).map((p) => p.wdsId));

  const rescuedWdsIds = new Set<string>();
  const outcomes: BlankRescueOutcome[] = [];
  const outcome = (p: WdsPair): BlankRescueOutcome => {
    if (donorKeys.has(discovererKey(p.wdsId, p.discoverer))) return 'donor';
    if (enumerated.has(p.wdsId) || rescuedWdsIds.has(p.wdsId)) return 'enumerated';
    return orb6WdsIds.has(p.wdsId) || simbadWdsIds.has(p.wdsId) ? 'rescued' : 'deferred';
  };
  const rescuedPairs = pairs.map((p) => {
    if (p.components !== '') return p;
    const o = outcome(p);
    outcomes.push(o);
    if (o !== 'rescued') return p;
    rescuedWdsIds.add(p.wdsId);
    return { ...p, components: IMPLIED_AB_COMPONENTS };
  });
  const alignedOrb6 = orb6.map((e) => (
    e.components === '' && rescuedWdsIds.has(e.wdsId) ? { ...e, components: IMPLIED_AB_COMPONENTS } : e
  ));
  return { pairs: rescuedPairs, orb6: alignedOrb6, outcomes };
}
