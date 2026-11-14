// Stage 2's per-component binding and the DecomposedPair every pass reads and returns. See README.md.

import { discovererKey, type DiscovererKey } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import { splitComponents, type WdsPair } from '../../wds/wds-pure';
import { OWN, RESOLVE_VIA, type IdOrigin, type ResolveVia } from '../multiples-tsv';
import { groupBy } from '../../util/map-buckets-pure';

/** Lower is stronger evidence. */
export const RESOLVE_VIA_PRIORITY: ReadonlyMap<ResolveVia, number> = new Map(RESOLVE_VIA.map((tag, i) => [tag, i]));

export function priorityOf(via: ResolveVia): number {
  return RESOLVE_VIA_PRIORITY.get(via) as number;
}

/** An identifier and where the component came by it. */
export interface Bound<T> {
  readonly value: T;
  readonly origin: IdOrigin;
}

export function own<T>(value: T): Bound<T> {
  return { value, origin: OWN };
}

/** The same identifier, now held under `origin`. */
export function inheritAs<T>(b: Bound<T>, origin: IdOrigin): Bound<T> {
  return { value: b.value, origin };
}

export function valueOf<T>(b: Bound<T> | null): T | null {
  return b === null ? null : b.value;
}

/** One side of one decomposing pair row, as Stage 2 bound it. */
export interface ResolvedComponent {
  readonly wdsId: string;
  readonly discoverer: string;
  /** As the components field writes it: a truncated secondary stays `"2"`. */
  readonly component: string;
  readonly isPrimary: boolean;
  readonly gaia: Bound<string> | null;
  readonly resolveVia: ResolveVia;
  readonly hip: Bound<number> | null;
  /** The position-matched AT-HYG row, for a row whose identifiers no index reaches. */
  readonly athyg: Bound<AthygRow> | null;
  /** The coord-validated ORB6 entry's HD, primaries only. */
  readonly hd: number | null;
}

export type Draft = { -readonly [K in keyof ResolvedComponent]: ResolvedComponent[K] };

export function unresolvedComponent(pair: WdsPair, component: string, isPrimary: boolean): ResolvedComponent {
  return {
    wdsId: pair.wdsId, discoverer: pair.discoverer, component, isPrimary,
    gaia: null, resolveVia: 'unresolved', hip: null, athyg: null, hd: null,
  };
}

export type PairsByDiscoverer = ReadonlyMap<DiscovererKey, readonly WdsPair[]>;

export function pairsByDiscoverer(pairs: readonly WdsPair[]): PairsByDiscoverer {
  return groupBy(pairs, (p) => discovererKey(p.wdsId, p.discoverer));
}

/** Not necessarily the row that produced `c`: README.md#choices-the-outputs-rest-on */
export function findOwningPair(c: ResolvedComponent, index: PairsByDiscoverer): WdsPair | null {
  const slot = c.isPrimary ? 0 : 1;
  for (const p of index.get(discovererKey(c.wdsId, c.discoverer)) ?? []) {
    const split = splitComponents(p.components);
    if (split !== null && split[slot] === c.component) return p;
  }
  return null;
}

/** One decomposing pair row and its two bound components: the record every
 *  stage keys its results on, Stage 2's own passes included. */
export interface DecomposedPair {
  readonly pair: WdsPair;
  /** The components field split as written. */
  readonly tokens: readonly [string, string];
  readonly primary: ResolvedComponent;
  readonly secondary: ResolvedComponent;
}

export interface DraftPair {
  readonly pair: WdsPair;
  readonly tokens: readonly [string, string];
  readonly primary: Draft;
  readonly secondary: Draft;
}

/** A pass's working copy: every component copied, so the input stays as it
 *  was. `components` views the same drafts, primary then secondary, in pair
 *  order: a pass reaches each through its pair, never by position. */
export interface Working {
  readonly pairs: readonly DraftPair[];
  readonly components: readonly Draft[];
}

export function working(pairs: readonly DecomposedPair[]): Working {
  const out = pairs.map((p): DraftPair => ({ pair: p.pair, tokens: p.tokens, primary: { ...p.primary }, secondary: { ...p.secondary } }));
  return { pairs: out, components: componentsOf(out) as Draft[] };
}

export function componentsOf(pairs: readonly DecomposedPair[]): readonly ResolvedComponent[] {
  return pairs.flatMap((p) => [p.primary, p.secondary]);
}

export function pairRows(pairs: readonly DecomposedPair[]): readonly WdsPair[] {
  return pairs.map((p) => p.pair);
}

/** Every pair row that splits, each side bound by `bind`. */
export function decompose(
  rows: readonly WdsPair[], bind: (pair: WdsPair, token: string, isPrimary: boolean) => ResolvedComponent,
): DecomposedPair[] {
  const out: DecomposedPair[] = [];
  for (const pair of rows) {
    const tokens = splitComponents(pair.components);
    if (tokens !== null) out.push({ pair, tokens, primary: bind(pair, tokens[0], true), secondary: bind(pair, tokens[1], false) });
  }
  return out;
}

export function freezePairs(pairs: readonly DecomposedPair[]): readonly DecomposedPair[] {
  return Object.freeze(pairs.map((p) => Object.freeze({
    pair: p.pair, tokens: p.tokens, primary: Object.freeze({ ...p.primary }), secondary: Object.freeze({ ...p.secondary }),
  })));
}
