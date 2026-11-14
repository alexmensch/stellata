// The identity propagations: one letter one star across a system's rows, ρ = 0 blends, synthesized-pair seeds, downward re-homing. See README.md.

import {
  canonicalCompLetter, componentKey, parentComponentToken, subcomponentTopLetter, type ComponentKey,
} from '../component-tokens-pure';
import type { WdsPair } from '../../wds/wds-pure';
import {
  findOwningPair, inheritedFrom, pairsByDiscoverer, priorityOf, working,
  type DecomposedPair, type Draft, type IdOrigin, type InheritanceKind, type ResolvedComponent,
} from './components-pure';
import type { ResolveVia } from '../multiples-tsv';

interface SourceBinding {
  readonly gaia: string;
  readonly via: ResolveVia;
  readonly origin: IdOrigin;
}

interface HipBinding {
  readonly hip: number;
  readonly origin: IdOrigin;
}

/** Each donor's strongest-tier source and first HIP, grouped under `donorKey`
 *  (null: no donor), filled into every heir's gaps under its own key. An heir
 *  records `origin(donor, held)` for an identifier the donor holds under `held`. */
function inheritWithin(
  out: readonly Draft[], donorKey: (c: Draft) => ComponentKey | null, isHeir: (c: Draft) => boolean,
  origin: (donor: Draft, held: IdOrigin) => IdOrigin,
): void {
  const sources = new Map<ComponentKey, SourceBinding>();
  const hips = new Map<ComponentKey, HipBinding>();
  for (const c of out) {
    const key = donorKey(c);
    if (key === null) continue;
    const cur = sources.get(key);
    if (c.gaiaSourceId !== null && (cur === undefined || priorityOf(c.resolveVia) < priorityOf(cur.via))) {
      sources.set(key, { gaia: c.gaiaSourceId, via: c.resolveVia, origin: origin(c, c.gaiaOrigin!) });
    }
    if (c.hip !== null && !hips.has(key)) hips.set(key, { hip: c.hip, origin: origin(c, c.hipOrigin!) });
  }
  for (const c of out) {
    if (!isHeir(c)) continue;
    const key = componentKey(c.wdsId, c.component);
    const binding = sources.get(key);
    if (c.gaiaSourceId === null && binding !== undefined) {
      c.gaiaSourceId = binding.gaia;
      c.gaiaOrigin = binding.origin;
      c.resolveVia = binding.via;
    }
    const hip = hips.get(key);
    if (c.hip === null && hip !== undefined) {
      c.hip = hip.hip;
      c.hipOrigin = hip.origin;
    }
  }
}

export function propagateWithinSystem(pairs: readonly DecomposedPair[]): readonly DecomposedPair[] {
  const w = working(pairs);
  inheritWithin(w.components, (c) => componentKey(c.wdsId, c.component), () => true, (_, held) => held);
  inheritWithin(
    w.components,
    (c) => {
      const top = subcomponentTopLetter(c.component);
      return top === null ? null : componentKey(c.wdsId, top);
    },
    (c) => c.component === c.component.toUpperCase() && c.component.length === 1,
    (donor) => inheritedFrom(donor.component, 'letter'),
  );
  return w.pairs;
}

export function propagateBlendIdentity(
  pairs: readonly DecomposedPair[],
): { pairs: readonly DecomposedPair[]; seeded: readonly ResolvedComponent[] } {
  const w = working(pairs);
  const seeded: Draft[] = [];
  for (const { pair, primary: p, secondary: s } of w.pairs) {
    if (pair.rhoLast === null || pair.rhoLast > 0) continue;
    if (s.gaiaSourceId !== null || s.hip !== null || s.athygRow !== null) continue;
    if (p.gaiaSourceId === null && p.hip === null && p.athygRow === null) continue;
    const blend = inheritedFrom(p.component, 'blend');
    s.gaiaSourceId = p.gaiaSourceId;
    s.gaiaOrigin = p.gaiaSourceId === null ? null : blend;
    s.hip = p.hip;
    s.hipOrigin = p.hip === null ? null : blend;
    s.athygRow = p.athygRow;
    s.athygOrigin = p.athygRow === null ? null : blend;
    if (p.gaiaSourceId !== null) s.resolveVia = p.resolveVia;
    seeded.push(s);
  }
  return { pairs: w.pairs, seeded };
}

/** Gaia, then HIP, then AT-HYG row: what an in-system donor is ranked by. */
function strength(c: ResolvedComponent): number {
  return (c.gaiaSourceId !== null ? 4 : 0) + (c.hip !== null ? 2 : 0) + (c.athygRow !== null ? 1 : 0);
}

/** Fills only what `dst` lacks; true when anything moved. */
function copyBinding(dst: Draft, src: ResolvedComponent, how: InheritanceKind): boolean {
  const origin = inheritedFrom(src.component, how);
  let changed = false;
  if (dst.gaiaSourceId === null && src.gaiaSourceId !== null) {
    dst.gaiaSourceId = src.gaiaSourceId;
    dst.gaiaOrigin = origin;
    dst.resolveVia = src.resolveVia;
    changed = true;
  }
  if (dst.hip === null && src.hip !== null) {
    dst.hip = src.hip;
    dst.hipOrigin = origin;
    changed = true;
  }
  if (dst.athygRow === null && src.athygRow !== null) {
    dst.athygRow = src.athygRow;
    dst.athygOrigin = origin;
    changed = true;
  }
  return changed;
}

/** A donor is read as the pass has left it: one seeded earlier in the walk donates what it was just given. */
export function seedSynthesizedComponentBindings(
  pairs: readonly DecomposedPair[], synthesizedPairs: readonly WdsPair[],
): { pairs: readonly DecomposedPair[]; seeded: readonly ResolvedComponent[] } {
  const w = working(pairs);
  const out = w.components;
  const seeded: Draft[] = [];
  if (synthesizedPairs.length === 0) return { pairs: w.pairs, seeded };
  const index = pairsByDiscoverer(synthesizedPairs);

  const donors = new Map<ComponentKey, Draft>();
  for (const c of out) {
    if (strength(c) === 0) continue;
    const key = componentKey(c.wdsId, c.component);
    const cur = donors.get(key);
    if (cur === undefined || strength(c) > strength(cur)) donors.set(key, c);
  }
  const primaryByPair = new Map<WdsPair, Draft>();
  for (const c of out) {
    if (!c.isPrimary) continue;
    const pair = findOwningPair(c, index);
    if (pair === null) continue;
    if (c.gaiaSourceId === null) {
      const parent = parentComponentToken(c.component);
      const donor = parent === null ? undefined : donors.get(componentKey(c.wdsId, parent));
      if (donor !== undefined && copyBinding(c, donor, 'parent')) seeded.push(c);
    }
    primaryByPair.set(pair, c);
  }
  for (const c of out) {
    if (c.isPrimary) continue;
    const pair = findOwningPair(c, index);
    if (pair === null || c.gaiaSourceId !== null) continue;
    const primary = primaryByPair.get(pair);
    if (primary !== undefined && copyBinding(c, primary, 'partner')) seeded.push(c);
  }
  return { pairs: w.pairs, seeded };
}

/** A sub-letter left unbound inherits its parent token's binding (20312's
 *  Aa/Ab follow A, not sibling BC). Only over `onlyWdsIds`, the systems
 *  enforcement touched: across untouched systems it would seat siblings on
 *  one source, which the writer cannot place twice. */
export function inheritDownwardParentBindings(
  pairs: readonly DecomposedPair[], onlyWdsIds: ReadonlySet<string>,
): { pairs: readonly DecomposedPair[]; seeded: readonly ResolvedComponent[] } {
  const w = working(pairs);
  const bound = new Map<ComponentKey, { gaia: string; via: ResolveVia; hip: number | null; token: string }>();
  const canon: { token: string; c: Draft }[] = [];
  for (const { pair, primary: p, secondary: s } of w.pairs) {
    if (!onlyWdsIds.has(pair.wdsId)) continue;
    for (const [token, c] of [[p.component, p], [canonicalCompLetter(p.component, s.component), s]] as const) {
      canon.push({ token, c });
      const key = componentKey(pair.wdsId, token);
      if (c.gaiaSourceId !== null && !bound.has(key)) bound.set(key, { gaia: c.gaiaSourceId, via: c.resolveVia, hip: c.hip, token });
    }
  }
  const seeded: Draft[] = [];
  for (const { token, c } of canon) {
    if (c.gaiaSourceId !== null) continue;
    const parent = parentComponentToken(token);
    const binding = parent === null ? undefined : bound.get(componentKey(c.wdsId, parent));
    if (binding === undefined) continue;
    const origin = inheritedFrom(binding.token, 'parent');
    c.gaiaSourceId = binding.gaia;
    c.gaiaOrigin = origin;
    c.resolveVia = binding.via;
    if (c.hip === null && binding.hip !== null) {
      c.hip = binding.hip;
      c.hipOrigin = origin;
    }
    seeded.push(c);
  }
  return { pairs: w.pairs, seeded };
}

/** Re-spreads within each system when a seeding pass moved anything. */
export function smearIfSeeded(result: { pairs: readonly DecomposedPair[]; seeded: readonly ResolvedComponent[] }): readonly DecomposedPair[] {
  return result.seeded.length > 0 ? propagateWithinSystem(result.pairs) : result.pairs;
}

/** One letter one star across each system, then the ρ = 0 blend convention. */
export function propagateIdentities(pairs: readonly DecomposedPair[]): readonly DecomposedPair[] {
  return smearIfSeeded(propagateBlendIdentity(propagateWithinSystem(pairs)));
}
