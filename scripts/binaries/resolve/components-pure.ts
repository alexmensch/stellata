// Stage 2's per-component binding, the pair walk over it, and the DecomposedPair it ends in. See README.md.

import { discovererKey, splitComponents, type DiscovererKey } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { WdsPair } from '../load/wds-pure';
import { RESOLVE_VIA } from '../multiples-tsv';

export type ResolveVia = (typeof RESOLVE_VIA)[number];

/** Lower is stronger evidence. */
export const RESOLVE_VIA_PRIORITY: ReadonlyMap<ResolveVia, number> = new Map(RESOLVE_VIA.map((tag, i) => [tag, i]));

export function priorityOf(via: ResolveVia): number {
  return RESOLVE_VIA_PRIORITY.get(via) as number;
}

/** One side of one decomposing pair row, as Stage 2 bound it. */
export interface ResolvedComponent {
  readonly wdsId: string;
  readonly discoverer: string;
  /** As the components field writes it: a truncated secondary stays `"2"`. */
  readonly component: string;
  readonly isPrimary: boolean;
  readonly gaiaSourceId: string | null;
  readonly resolveVia: ResolveVia;
  readonly hip: number | null;
  /** The position-matched AT-HYG row, for a row whose identifiers no index reaches. */
  readonly athygRow: AthygRow | null;
  /** The coord-validated ORB6 entry's HD, primaries only. */
  readonly hd: number | null;
}

export type Draft = { -readonly [K in keyof ResolvedComponent]: ResolvedComponent[K] };

/** A pass's working copy: every record copied, so the input stays as it was. */
export function drafts(components: readonly ResolvedComponent[]): Draft[] {
  return components.map((c) => ({ ...c }));
}

export function unresolvedComponent(pair: WdsPair, component: string, isPrimary: boolean): ResolvedComponent {
  return {
    wdsId: pair.wdsId, discoverer: pair.discoverer, component, isPrimary,
    gaiaSourceId: null, resolveVia: 'unresolved', hip: null, athygRow: null, hd: null,
  };
}

export type PairsByDiscoverer = ReadonlyMap<DiscovererKey, readonly WdsPair[]>;

export function pairsByDiscoverer(pairs: readonly WdsPair[]): PairsByDiscoverer {
  const out = new Map<DiscovererKey, WdsPair[]>();
  for (const p of pairs) {
    const key = discovererKey(p.wdsId, p.discoverer);
    const bucket = out.get(key);
    if (bucket) bucket.push(p);
    else out.set(key, [p]);
  }
  return out;
}

/** Not necessarily the row that produced `c`: README.md#byte-identity-with-the-python-stage */
export function findOwningPair(c: ResolvedComponent, index: PairsByDiscoverer): WdsPair | null {
  const slot = c.isPrimary ? 0 : 1;
  for (const p of index.get(discovererKey(c.wdsId, c.discoverer)) ?? []) {
    const split = splitComponents(p.components);
    if (split !== null && split[slot] === c.component) return p;
  }
  return null;
}

export function* decomposingPairs(
  pairs: readonly WdsPair[], components: readonly ResolvedComponent[],
): Generator<{ pair: WdsPair; primary: number; secondary: number }> {
  let i = 0;
  for (const pair of pairs) {
    if (splitComponents(pair.components) === null) continue;
    if (i + 1 >= components.length) throw new Error('component walk exhausted before the pairs: Stage 2 output truncated');
    if (components[i].wdsId !== pair.wdsId || components[i + 1].wdsId !== pair.wdsId) {
      throw new Error(
        `component walk out of step at pair ${pair.wdsId}/${pair.components}: `
        + `got components ${components[i].wdsId} + ${components[i + 1].wdsId}`,
      );
    }
    yield { pair, primary: i, secondary: i + 1 };
    i += 2;
  }
}

/** One decomposing pair row and its two bound components: the record every
 *  later stage keys its results on. */
export interface DecomposedPair {
  readonly pair: WdsPair;
  /** The components field split as written. */
  readonly tokens: readonly [string, string];
  readonly primary: ResolvedComponent;
  readonly secondary: ResolvedComponent;
}

export function toDecomposedPairs(
  pairs: readonly WdsPair[], components: readonly ResolvedComponent[],
): readonly DecomposedPair[] {
  const out: DecomposedPair[] = [];
  for (const { pair, primary, secondary } of decomposingPairs(pairs, components)) {
    const p = Object.freeze({ ...components[primary] });
    const s = Object.freeze({ ...components[secondary] });
    out.push(Object.freeze({ pair, tokens: Object.freeze([p.component, s.component] as const), primary: p, secondary: s }));
  }
  if (out.length * 2 !== components.length) {
    throw new Error(`${components.length} components for ${out.length} decomposing pairs`);
  }
  return Object.freeze(out);
}
