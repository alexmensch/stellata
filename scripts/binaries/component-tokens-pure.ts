// WDS component-letter tokens on the TypeScript side. See README.md#files-in-this-area.

/** `synth-<wds_id>-<comp>` from a Stage 6 `system_id` (`<wds_id>-<components>`,
 *  split on its last dash so a negative-Dec WDS id survives); null when the
 *  comp is blank or the system_id has no WDS id. */
export function composeSyntheticId(
  systemId: string,
  comp: string,
): string | null {
  const c = comp.trim();
  if (!c) return null;
  const dash = systemId.lastIndexOf('-');
  if (dash < 0) return null;
  const wdsId = systemId.slice(0, dash);
  if (!wdsId) return null;
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

function tokenLetters(tok: string): Set<string> {
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
