// WDS component-letter tokens on the TypeScript side. See README.md#files-in-this-area.

import { ascending } from '../../src/astro-core/order-pure';
import { splitComponents } from '../wds/wds-pure';
import type { OrbitRole } from './multiples-record-pure';

/** The WDS id of a Stage 6 `system_id` (`<wds_id>-<components>`), or of a
 *  synth key's `<wds_id>-<comp>` body: everything before the last dash, so a
 *  negative-Dec id (`04153-0739-BC`) survives. Null when there is none. */
export function wdsRootOf(systemId: string): string | null {
  const dash = systemId.lastIndexOf('-');
  if (dash < 0) return null;
  return systemId.slice(0, dash) || null;
}

/** `synth-<wds_id>-<comp>`. Every multiples.tsv row composes one: its reader
 *  refuses a blank comp or a system_id with no WDS id, so this throws on either. */
export function composeSyntheticId(systemId: string, comp: string): string {
  const wdsId = wdsRootOf(systemId);
  if (wdsId === null) throw new Error(`no synthetic key composes from system_id "${systemId}", comp "${comp}"`);
  return syntheticIdIn(wdsId, comp);
}

/** `synth-<wds_id>-<comp>` for a component of WDS system `wdsId`; throws on a blank comp. */
export function syntheticIdIn(wdsId: string, comp: string): string {
  const c = comp.trim();
  if (!c) throw new Error(`no synthetic key composes in ${wdsId} from comp "${comp}"`);
  return `synth-${wdsId}-${c}`;
}

/** The synthetic key a multiples.tsv row composes: a pair's secondary on its
 *  canonical letter, re-anchored on its pair's primary; every other row on its own comp. */
export function rowSyntheticId(
  row: { readonly systemId: string; readonly comp: string; readonly orbitRole: OrbitRole },
  pairPrimaryComp: string | null,
): string {
  const comp = row.orbitRole === 'secondary' && pairPrimaryComp !== null ? canonicalCompLetter(pairPrimaryComp, row.comp) : row.comp;
  return composeSyntheticId(row.systemId, comp);
}

/** Re-anchor WDS prefix truncation on a secondary's comp: Stage 6 writes
 *  `"2"` for the secondary of `"Aa1,2"`, whose canonical form is `"Aa2"`.
 *  Every synthetic id and display letter keys on the canonical form. */
export function canonicalCompLetter(
  primaryComp: string,
  secondaryComp: string,
): string {
  const sec = secondaryComp.trim();
  const pri = primaryComp.trim();
  if (sec && /^\d+$/.test(sec) && pri.length >= 2 && /\d$/.test(pri)) {
    return pri.slice(0, -1) + sec;
  }
  return sec;
}

/** `"Ba" → "B"`, `"Aa1" → "Aa"`, `"A" → null`: the rightmost designator dropped. */
export function parentComponentToken(comp: string): string | null {
  const c = comp.trim();
  return c.length > 1 ? c.slice(0, -1) : null;
}

/** One component, not a compound: `"A"`, `"Aa"`, `"Aa1"`. Only these sit in
 *  the letter hierarchy; a compound's overlap is `compoundContains`. */
export function isComponentToken(tok: string): boolean {
  return /^[A-Z][a-z]?\d?$/.test(tok);
}

function isHierAncestor(a: string, b: string): boolean {
  if (!isComponentToken(a) || !isComponentToken(b)) return false;
  for (let cur = parentComponentToken(b); cur !== null; cur = parentComponentToken(cur)) {
    if (cur === a) return true;
  }
  return false;
}

/** Equal, or one is the other's ancestor (`A` / `Aa` / `Aa1`). */
export function relatedHier(a: string, b: string): boolean {
  return a === b || isHierAncestor(a, b) || isHierAncestor(b, a);
}

/** The capital letters of a token: `"AB"` → {A, B}, `"Aa1"` → {A}. */
export function tokenLetters(tok: string): Set<string> {
  return new Set(tok.match(/[A-Z]/g) ?? []);
}

/** One token is a multi-letter compound whose capitals include all of the
 *  other's: `"AB"` contains `"A"` and `"Aa"`. */
export function compoundContains(a: string, b: string): boolean {
  const la = tokenLetters(a);
  const lb = tokenLetters(b);
  const within = (inner: Set<string>, outer: Set<string>): boolean =>
    outer.size >= 2 && inner.size > 0 && [...inner].every((l) => outer.has(l));
  return within(lb, la) || within(la, lb);
}

/** The steps that rank two pair primaries under one WDS root, in order. */
export const ANCHOR_RANK_STEPS = ['letter', 'length', 'alphabetical'] as const;
export type AnchorRankStep = (typeof ANCHOR_RANK_STEPS)[number];

/** The first rank step on which two tokens differ; null for one token. */
export function anchorRankStep(a: string, b: string): AnchorRankStep | null {
  if (a === b) return null;
  if (a.charAt(0) !== b.charAt(0)) return 'letter';
  if (a.length !== b.length) return 'length';
  return 'alphabetical';
}

/** Pair primaries under one WDS root, most canonical first: the top-level
 *  letter decides, then token length, then alphabetical order. */
export function compareAnchorRank(a: string, b: string): number {
  switch (anchorRankStep(a, b)) {
    case null: return 0;
    case 'letter': return ascending(a.charAt(0), b.charAt(0));
    case 'length': return ascending(a.length, b.length);
    case 'alphabetical': return ascending(a, b);
  }
}

export function isMoreCanonicalAnchor(candidateComp: string, incumbentComp: string): boolean {
  return compareAnchorRank(candidateComp, incumbentComp) < 0;
}

declare const KEY_SPACE: unique symbol;
/** A tab-joined map key, branded by what it keys so one space cannot look up another's map. */
type Key<Space extends string> = string & { readonly [KEY_SPACE]: Space };

/** One component of one WDS system: `(wds_id, token)`. */
export type ComponentKey = Key<'component'>;
/** One discoverer's rows in one WDS system: `(wds_id, discoverer)`. */
export type DiscovererKey = Key<'discoverer'>;
/** A pair row by its system and `components` field as written. */
export type PairRowKey = Key<'pair-row'>;

export function componentKey(wdsId: string, token: string): ComponentKey {
  return `${wdsId}\t${token}` as ComponentKey;
}

export function discovererKey(wdsId: string, discoverer: string): DiscovererKey {
  return `${wdsId}\t${discoverer}` as DiscovererKey;
}

export function pairRowKey(wdsId: string, components: string): PairRowKey {
  return `${wdsId}\t${components}` as PairRowKey;
}

/** `splitComponents` with the secondary's WDS truncation re-anchored
 *  (`Aa1,2` → Aa1, Aa2): the token pair a pair row names. */
export function pairComponentTokens(components: string): readonly [string, string] | null {
  const split = splitComponents(components);
  return split === null ? null : [split[0], canonicalCompLetter(split[0], split[1])];
}

/** The sub-pair one level below: `"A"` → Aa, Ab; `"Aa"` → Aa1, Aa2. Null for
 *  a digit-bearing token (WDS names nothing below `Aa1`) and for a compound. */
export function childComponentTokens(tok: string): readonly [string, string] | null {
  if (/^[A-Z]$/.test(tok)) return [tok + 'a', tok + 'b'];
  if (/^[A-Z][a-z]$/.test(tok)) return [tok + '1', tok + '2'];
  return null;
}

/** The top-level letter of a lowercase sub-component — `"Aa"`, `"Bbc"` → A,
 *  B — and null for a bare letter or a digit-bearing token. Where
 *  `parentComponentToken` is the immediate parent, this is the root letter. */
export function subcomponentTopLetter(tok: string): string | null {
  const m = /^([A-Z])[a-z]+$/.exec(tok);
  return m === null ? null : m[1];
}
