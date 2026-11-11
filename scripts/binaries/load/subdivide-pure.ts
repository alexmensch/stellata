// Stage 1's sub-pair passes: curated ORB6 component letters, ORB6 orphan pairs, MSC inner pairs. README.md#sub-pair-synthesis.

import type { SkyPosition } from '../../../src/astro-core/equatorial-basis';
import {
  discovererKey, isComponentToken, pairComponentTokens, pairRowKey, parentComponentToken, tokenLetters,
  type DiscovererKey, type PairRowKey,
} from '../component-tokens-pure';
import { mscRenderable, type MscLookup, type MscPairOrbits } from './msc-pure';
import type { Orb6Entry, WdsPair } from '../../wds/wds-pure';

export const SYNTH_MSC_DISCOVERER = 'MSC';

/** ρ = 0 is WDS's own convention for a measured-but-unresolved pair (Castor
 *  CIA 29 Aa,Ab): companion promotion collocates it on the primary. */
export const SYNTH_SUB_RESOLUTION_RHO_ARCSEC = 0.0;
export const SYNTH_SUB_RESOLUTION_THETA_DEG = 0.0;

export const MSC_SYNTHESIS_OUTCOMES = [
  'synthesized',
  'skipped_unknown_system',
  'skipped_token_shape',
  'skipped_incomplete_elements',
  'skipped_pair_exists',
  'skipped_children_exist',
  'skipped_unanchored',
] as const;
export type MscSynthesisOutcome = (typeof MSC_SYNTHESIS_OUTCOMES)[number];

export const ORB6_OVERRIDE_OUTCOMES = ['applied', 'unchanged'] as const;
export type Orb6OverrideOutcome = (typeof ORB6_OVERRIDE_OUTCOMES)[number];

/** `outcomes` is one per entry. */
export function applyOrb6ComponentOverrides(
  orb6: readonly Orb6Entry[], overrides: ReadonlyMap<DiscovererKey, string>,
): { entries: readonly Orb6Entry[]; outcomes: readonly Orb6OverrideOutcome[] } {
  const outcomes: Orb6OverrideOutcome[] = [];
  const entries = orb6.map((e) => {
    const mapped = overrides.get(discovererKey(e.wdsId, e.discoverer));
    const applies = mapped !== undefined && mapped !== e.components;
    outcomes.push(applies ? 'applied' : 'unchanged');
    return applies ? { ...e, components: mapped } : e;
  });
  return { entries, outcomes };
}

/** Splits into two distinct single-component tokens once WDS truncation is
 *  re-anchored — not ORB6's fixed-width misalignment garbage (`95`, `a,Ab`). */
function isSynthesizableSubpair(components: string): boolean {
  const tokens = pairComponentTokens(components);
  return tokens !== null && tokens[0] !== tokens[1] && isComponentToken(tokens[0]) && isComponentToken(tokens[1]);
}

/** A synthesized pair row: sub-resolution, no date, photometry or notes. */
export function subResolutionPair(wdsId: string, discoverer: string, components: string, precise: SkyPosition | null): WdsPair {
  return {
    wdsId, discoverer, components, precise,
    dateLast: null,
    rhoLast: SYNTH_SUB_RESOLUTION_RHO_ARCSEC,
    thetaLast: SYNTH_SUB_RESOLUTION_THETA_DEG,
    magPri: null,
    magSec: null,
    spectral: '',
    notes: '',
    nObs: null,
    dateFirst: null,
    thetaFirst: null,
    rhoFirst: null,
  };
}

function firstPreciseByWds(pairs: readonly WdsPair[]): Map<string, SkyPosition> {
  const out = new Map<string, SkyPosition>();
  for (const p of pairs) if (p.precise !== null && !out.has(p.wdsId)) out.set(p.wdsId, p.precise);
  return out;
}

/** One pair per ORB6 `(wds_id, components)` naming a clean sub-pair WDS has no
 *  row for (64 Psc Aa,Ab, Castor Ca,Cb): every later stage walks pairs, so
 *  without one the orbit is unreachable. A blank-components WDS row under the
 *  same `(wds_id, discoverer)` is the same physical pair and donates its
 *  geometry, magnitudes and notes; with none the pair is sub-resolution. The
 *  coordinate falls back donor → ORB6's own → any row of the system. */
export function synthesizeOrb6OrphanPairs(wdsPairs: readonly WdsPair[], orb6: readonly Orb6Entry[]): WdsPair[] {
  const wdsKeys = new Set(wdsPairs.map((p) => pairRowKey(p.wdsId, p.components)));
  const blankByWdsDisc = new Map<DiscovererKey, WdsPair>();
  for (const p of wdsPairs) {
    const key = discovererKey(p.wdsId, p.discoverer);
    if (p.components === '' && !blankByWdsDisc.has(key)) blankByWdsDisc.set(key, p);
  }
  const systemPrecise = firstPreciseByWds(wdsPairs);

  const out: WdsPair[] = [];
  const seen = new Set<PairRowKey>();
  for (const e of orb6) {
    const key = pairRowKey(e.wdsId, e.components);
    if (wdsKeys.has(key) || seen.has(key) || !isSynthesizableSubpair(e.components)) continue;
    seen.add(key);
    const donor = blankByWdsDisc.get(discovererKey(e.wdsId, e.discoverer));
    const precise = donor?.precise ?? e.precise ?? systemPrecise.get(e.wdsId) ?? null;
    out.push(donor === undefined
      ? subResolutionPair(e.wdsId, e.discoverer, e.components, precise)
      : {
        ...subResolutionPair(e.wdsId, e.discoverer, e.components, precise),
        dateLast: donor.dateLast,
        rhoLast: donor.rhoLast,
        thetaLast: donor.thetaLast,
        magPri: donor.magPri,
        magSec: donor.magSec,
        spectral: donor.spectral,
        notes: donor.notes,
      });
  }
  return out;
}

function unorderedPairKey(a: string, b: string): string {
  return a < b ? `${a}\t${b}` : `${b}\t${a}`;
}

function compareMscPairs(a: MscPairOrbits, b: MscPairOrbits): number {
  for (const [x, y] of [[a.wdsId, b.wdsId], [a.primary, b.primary], [a.secondary, b.secondary]]) {
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** README.md#sub-pair-synthesis */
export function synthesizeMscInnerPairs(
  wdsPairs: readonly WdsPair[], msc: MscLookup,
): { pairs: WdsPair[]; outcomes: MscSynthesisOutcome[] } {
  const pairTokensByWds = new Map<string, Set<string>>();
  const tokensByWds = new Map<string, Set<string>>();
  const lettersByWds = new Map<string, Set<string>>();
  const setOf = (m: Map<string, Set<string>>, wdsId: string): Set<string> => {
    let s = m.get(wdsId);
    if (s === undefined) m.set(wdsId, (s = new Set()));
    return s;
  };
  for (const p of wdsPairs) {
    const letters = setOf(lettersByWds, p.wdsId);
    for (const l of tokenLetters(p.components)) letters.add(l);
    const tokens = pairComponentTokens(p.components);
    if (tokens === null) continue;
    setOf(pairTokensByWds, p.wdsId).add(unorderedPairKey(tokens[0], tokens[1]));
    setOf(tokensByWds, p.wdsId).add(tokens[0]).add(tokens[1]);
  }
  const systemPrecise = firstPreciseByWds(wdsPairs);
  const anchored = (token: string, wdsId: string): boolean => {
    const parent = parentComponentToken(token);
    return parent !== null
      ? tokensByWds.get(wdsId)?.has(parent) ?? false
      : lettersByWds.get(wdsId)?.has(token) ?? false;
  };
  const verdict = (o: MscPairOrbits): MscSynthesisOutcome => {
    const { wdsId, primary: a, secondary: b } = o;
    if (!lettersByWds.has(wdsId)) return 'skipped_unknown_system';
    if (!(isComponentToken(a) && isComponentToken(b) && a !== b)) return 'skipped_token_shape';
    if (!o.rows.some(mscRenderable)) return 'skipped_incomplete_elements';
    if (pairTokensByWds.get(wdsId)?.has(unorderedPairKey(a, b))) return 'skipped_pair_exists';
    const existing = tokensByWds.get(wdsId);
    if (existing?.has(a) || existing?.has(b)) return 'skipped_children_exist';
    if (!(anchored(a, wdsId) && anchored(b, wdsId))) return 'skipped_unanchored';
    return 'synthesized';
  };

  const pairs: WdsPair[] = [];
  const outcomes: MscSynthesisOutcome[] = [];
  for (const o of [...msc.orbitsByPair.values()].sort(compareMscPairs)) {
    const outcome = verdict(o);
    outcomes.push(outcome);
    if (outcome !== 'synthesized') continue;
    pairs.push(subResolutionPair(
      o.wdsId, SYNTH_MSC_DISCOVERER, `${o.primary},${o.secondary}`, systemPrecise.get(o.wdsId) ?? null,
    ));
    setOf(pairTokensByWds, o.wdsId).add(unorderedPairKey(o.primary, o.secondary));
    setOf(tokensByWds, o.wdsId).add(o.primary).add(o.secondary);
  }
  return { pairs, outcomes };
}
