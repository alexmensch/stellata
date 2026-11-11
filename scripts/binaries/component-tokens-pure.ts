// WDS component-letter tokens on the TypeScript side. See README.md#files-in-this-area.

import { splitComponents } from '../wds/wds-pure';

/** The WDS id of a Stage 6 `system_id` (`<wds_id>-<components>`), or of a
 *  synth key's `<wds_id>-<comp>` body: everything before the last dash, so a
 *  negative-Dec id (`04153-0739-BC`) survives. Null when there is none. */
export function wdsRootOf(systemId: string): string | null {
  const dash = systemId.lastIndexOf('-');
  if (dash < 0) return null;
  return systemId.slice(0, dash) || null;
}

/** `synth-<wds_id>-<comp>`; null when the comp is blank or the system_id has no WDS id. */
export function composeSyntheticId(
  systemId: string,
  comp: string,
): string | null {
  const c = comp.trim();
  const wdsId = wdsRootOf(systemId);
  if (!c || wdsId === null) return null;
  return `synth-${wdsId}-${c}`;
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

/** The more canonical of two pair primaries under one WDS root: the
 *  top-level letter decides, then token length, then alphabetical order.
 *  `anchor_offsets.py`'s `anchor_token_rank` is its Python twin until the
 *  switch; change both. */
export function isMoreCanonicalAnchor(candidateComp: string, incumbentComp: string): boolean {
  if (candidateComp === incumbentComp) return false;
  const branch = (comp: string) => comp.charAt(0);
  if (branch(candidateComp) !== branch(incumbentComp)) return branch(candidateComp) < branch(incumbentComp);
  if (candidateComp.length !== incumbentComp.length) return candidateComp.length < incumbentComp.length;
  return candidateComp < incumbentComp;
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
