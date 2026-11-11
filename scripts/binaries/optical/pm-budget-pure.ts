// The orbital-PM budget: the motion a pair's components carry from tighter sub-pairs they host. See ../README.md#stage-5--optical-pair-filter-cascade.

import { compoundContains, pairComponentTokens, relatedHier } from '../component-tokens-pure';
import type { PairOrbit } from '../orbits/select-orbit-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import {
  CIRCULAR_KM_S_1AU_1MSUN, ESCAPE_GATE_PM_AVERAGING_PERIOD_DAYS, ESCAPE_GATE_SUBSYSTEM_FLOOR_SEP_AU,
} from './optical-tiers-pure';

/** `x` moves with sub-pair (u, v): a side of it, a hierarchy relative of a side, or inside a compound side. */
function participates(x: string, u: string, v: string): boolean {
  return [u, v].some((t) => relatedHier(x, t) || compoundContains(x, t));
}

/** `systemPairs` is the pair's whole WDS system, in pair order, `p` among them. */
export function orbitalPmBudgetKmS(
  p: DecomposedPair,
  systemPairs: readonly DecomposedPair[],
  orbits: ReadonlyMap<DecomposedPair, PairOrbit>,
  masses: ReadonlyMap<DecomposedPair, number>,
  anchorParallaxMas: number | null,
): number {
  const tokens = pairComponentTokens(p.pair.components);
  const rhoP = p.pair.rhoLast ?? 0.0;
  if (tokens === null || rhoP <= 0.0) return 0.0;
  const dPc = anchorParallaxMas ? 1000.0 / anchorParallaxMas : null;
  let budget = 0.0;
  for (const q of systemPairs) {
    if (q === p) continue;
    const rhoQ = q.pair.rhoLast ?? 0.0;
    if (rhoQ >= rhoP) continue;
    const qTokens = pairComponentTokens(q.pair.components);
    if (qTokens === null || !tokens.some((x) => participates(x, qTokens[0], qTokens[1]))) continue;
    const orbit = orbits.get(q)!;
    const elements = orbit.orbitVia === 'none' ? null : orbit.elements;
    if (elements !== null && elements.pDays !== null && elements.pDays < ESCAPE_GATE_PM_AVERAGING_PERIOD_DAYS) continue;
    let rAu: number | null = null;
    if (elements !== null && elements.aAu !== null && elements.aAu > 0.0) rAu = elements.aAu;
    else if (rhoQ > 0.0 && dPc !== null) rAu = rhoQ * dPc;
    const rEff = rAu === null ? ESCAPE_GATE_SUBSYSTEM_FLOOR_SEP_AU : Math.max(rAu, ESCAPE_GATE_SUBSYSTEM_FLOOR_SEP_AU);
    budget += CIRCULAR_KM_S_1AU_1MSUN * Math.sqrt(masses.get(q)! / rEff);
  }
  return budget;
}
