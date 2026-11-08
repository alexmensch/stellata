// The identity propagations: one letter one star across a system's rows, ρ = 0 blends, synthesized-pair seeds, downward re-homing. See README.md.

import {
  canonicalCompLetter, componentKey, parentComponentToken, subcomponentTopLetter, type ComponentKey,
} from '../component-tokens-pure';
import type { WdsPair } from '../load/wds-pure';
import {
  decomposingPairs, drafts, findOwningPair, pairsByDiscoverer, priorityOf,
  type Draft, type ResolvedComponent, type ResolveVia,
} from './components-pure';

interface SourceBinding {
  readonly gaia: string;
  readonly via: ResolveVia;
}

function keepStronger(map: Map<ComponentKey, SourceBinding>, key: ComponentKey, c: Draft): void {
  if (c.gaiaSourceId === null) return;
  const cur = map.get(key);
  if (cur === undefined || priorityOf(c.resolveVia) < priorityOf(cur.via)) map.set(key, { gaia: c.gaiaSourceId, via: c.resolveVia });
}

function inherit(
  c: Draft, key: ComponentKey, sources: ReadonlyMap<ComponentKey, SourceBinding>, hips: ReadonlyMap<ComponentKey, number>,
): void {
  if (c.gaiaSourceId === null) {
    const binding = sources.get(key);
    if (binding !== undefined) {
      c.gaiaSourceId = binding.gaia;
      c.resolveVia = binding.via;
    }
  }
  if (c.hip === null) c.hip = hips.get(key) ?? null;
}

export function propagateWithinSystem(components: readonly ResolvedComponent[]): ResolvedComponent[] {
  const out = drafts(components);
  const sources = new Map<ComponentKey, SourceBinding>();
  const hips = new Map<ComponentKey, number>();
  for (const c of out) {
    const key = componentKey(c.wdsId, c.component);
    keepStronger(sources, key, c);
    if (c.hip !== null && !hips.has(key)) hips.set(key, c.hip);
  }
  for (const c of out) inherit(c, componentKey(c.wdsId, c.component), sources, hips);

  const subSources = new Map<ComponentKey, SourceBinding>();
  const subHips = new Map<ComponentKey, number>();
  for (const c of out) {
    const top = subcomponentTopLetter(c.component);
    if (top === null) continue;
    const key = componentKey(c.wdsId, top);
    keepStronger(subSources, key, c);
    if (c.hip !== null && !subHips.has(key)) subHips.set(key, c.hip);
  }
  for (const c of out) {
    if (c.component !== c.component.toUpperCase() || c.component.length !== 1) continue;
    inherit(c, componentKey(c.wdsId, c.component), subSources, subHips);
  }
  return out;
}

export function propagateBlendIdentity(
  components: readonly ResolvedComponent[], pairs: readonly WdsPair[],
): { components: ResolvedComponent[]; seeded: readonly ResolvedComponent[] } {
  const out = drafts(components);
  const seeded: Draft[] = [];
  for (const { pair, primary, secondary } of decomposingPairs(pairs, out)) {
    if (pair.rhoLast === null || pair.rhoLast > 0) continue;
    const p = out[primary];
    const s = out[secondary];
    if (s.gaiaSourceId !== null || s.hip !== null || s.athygRow !== null) continue;
    if (p.gaiaSourceId === null && p.hip === null && p.athygRow === null) continue;
    s.gaiaSourceId = p.gaiaSourceId;
    s.hip = p.hip;
    s.athygRow = p.athygRow;
    if (p.gaiaSourceId !== null) s.resolveVia = p.resolveVia;
    seeded.push(s);
  }
  return { components: out, seeded };
}

/** Gaia, then HIP, then AT-HYG row: what an in-system donor is ranked by. */
function strength(c: ResolvedComponent): number {
  return (c.gaiaSourceId !== null ? 4 : 0) + (c.hip !== null ? 2 : 0) + (c.athygRow !== null ? 1 : 0);
}

/** Fills only what `dst` lacks; true when anything moved. */
function copyBinding(dst: Draft, src: ResolvedComponent): boolean {
  let changed = false;
  if (dst.gaiaSourceId === null && src.gaiaSourceId !== null) {
    dst.gaiaSourceId = src.gaiaSourceId;
    dst.resolveVia = src.resolveVia;
    changed = true;
  }
  if (dst.hip === null && src.hip !== null) {
    dst.hip = src.hip;
    changed = true;
  }
  if (dst.athygRow === null && src.athygRow !== null) {
    dst.athygRow = src.athygRow;
    changed = true;
  }
  return changed;
}

/** A donor is read as the pass has left it: one seeded earlier in the walk donates what it was just given. */
export function seedSynthesizedComponentBindings(
  components: readonly ResolvedComponent[], synthesizedPairs: readonly WdsPair[],
): { components: ResolvedComponent[]; seeded: readonly ResolvedComponent[] } {
  const out = drafts(components);
  const seeded: Draft[] = [];
  if (synthesizedPairs.length === 0) return { components: out, seeded };
  const index = pairsByDiscoverer(synthesizedPairs);

  const donors = new Map<ComponentKey, Draft>();
  for (const c of out) {
    if (strength(c) === 0) continue;
    const key = componentKey(c.wdsId, c.component);
    const cur = donors.get(key);
    if (cur === undefined || strength(c) > strength(cur)) donors.set(key, c);
  }
  const primaryByPair = new Map<string, Draft>();
  for (const c of out) {
    if (!c.isPrimary) continue;
    const pair = findOwningPair(c, index);
    if (pair === null) continue;
    if (c.gaiaSourceId === null) {
      const parent = parentComponentToken(c.component);
      const donor = parent === null ? undefined : donors.get(componentKey(c.wdsId, parent));
      if (donor !== undefined && copyBinding(c, donor)) seeded.push(c);
    }
    primaryByPair.set(`${c.wdsId}\t${c.discoverer}\t${pair.components}`, c);
  }
  for (const c of out) {
    if (c.isPrimary) continue;
    const pair = findOwningPair(c, index);
    if (pair === null || c.gaiaSourceId !== null) continue;
    const primary = primaryByPair.get(`${c.wdsId}\t${c.discoverer}\t${pair.components}`);
    if (primary !== undefined && copyBinding(c, primary)) seeded.push(c);
  }
  return { components: out, seeded };
}

/** A sub-letter left unbound inherits its parent token's binding (20312's
 *  Aa/Ab follow A, not sibling BC). Only over `onlyWdsIds`, the systems
 *  enforcement touched: across untouched systems it would seat siblings on
 *  one source, which the writer cannot place twice. */
export function inheritDownwardParentBindings(
  pairs: readonly WdsPair[], components: readonly ResolvedComponent[], onlyWdsIds: ReadonlySet<string>,
): { components: ResolvedComponent[]; seeded: readonly ResolvedComponent[] } {
  const out = drafts(components);
  const bound = new Map<ComponentKey, { gaia: string; via: ResolveVia; hip: number | null }>();
  const canon: { token: string; c: Draft }[] = [];
  for (const { pair, primary, secondary } of decomposingPairs(pairs, out)) {
    if (!onlyWdsIds.has(pair.wdsId)) continue;
    const p = out[primary];
    const s = out[secondary];
    for (const [token, c] of [[p.component, p], [canonicalCompLetter(p.component, s.component), s]] as const) {
      canon.push({ token, c });
      const key = componentKey(pair.wdsId, token);
      if (c.gaiaSourceId !== null && !bound.has(key)) bound.set(key, { gaia: c.gaiaSourceId, via: c.resolveVia, hip: c.hip });
    }
  }
  const seeded: Draft[] = [];
  for (const { token, c } of canon) {
    if (c.gaiaSourceId !== null) continue;
    const parent = parentComponentToken(token);
    const binding = parent === null ? undefined : bound.get(componentKey(c.wdsId, parent));
    if (binding === undefined) continue;
    c.gaiaSourceId = binding.gaia;
    c.resolveVia = binding.via;
    if (c.hip === null && binding.hip !== null) c.hip = binding.hip;
    seeded.push(c);
  }
  return { components: out, seeded };
}
