// The HD / CCDM / HIP alias cascade for WDS components SIMBAD holds under no WDS ident, and the HIP an object's aliases name. See README.md#the-run.

import type { ParseLedger } from '../simbad/simbad-fetch-pure';
import { HD, HIP, compose, identKey, parseIdent, type Namespace, type ParsedIdent } from '../simbad/simbad-specs-pure';
import { componentId, type WdsComponent } from './wds-components-pure';

export const CASCADE_STRATEGIES = ['HD', 'CCDM', 'HIP'] as const;
export type CascadeStrategy = (typeof CASCADE_STRATEGIES)[number];

/** One HD or HIP id an object holds: its number, and the component letter after it, null for the bare number. */
export interface CatalogueAlias {
  readonly number: string;
  readonly letter: string | null;
}

/** `id` read under `ns`; null for another namespace, and for an id the namespace rules cannot read, which fails `ledger`. */
export function catalogueAlias(ns: Namespace, id: string, ledger: ParseLedger): CatalogueAlias | null {
  const parsed = parseIdent(ns, id);
  if (parsed.kind === 'unparsed') ledger.note(parsed);
  if (parsed.kind === 'suffix') return { number: parsed.suffix, letter: null };
  return parsed.kind === 'component' ? { number: parsed.number, letter: parsed.letter } : null;
}

/** The bare HIP wins; otherwise a lettered one binds only when its letter is one the object was resolved as (ξ UMa B holds only `HIP 55203B`), and two different HIPs that both match bind neither. */
export function resolveHip(aliases: readonly CatalogueAlias[], letters: ReadonlySet<string>): string | null {
  const bare = aliases.find((a) => a.letter === null);
  if (bare !== undefined) return bare.number;
  const matched = new Set(aliases.filter((a) => a.letter !== null && letters.has(a.letter)).map((a) => a.number));
  return matched.size === 1 ? [...matched][0] : null;
}

export interface CascadeCandidate {
  /** The id asked; SIMBAD answers in its stored spelling, so a reply joins back on `replyKey`. */
  readonly id: string;
  readonly component: WdsComponent;
  readonly strategy: CascadeStrategy;
}

const LETTERED = [HD, HIP] as const;

/** The number and letter a parsed HD or HIP id names; null for a bare number or an id the namespace rules cannot read. */
const letteredKey = (ns: Namespace, parsed: ParsedIdent): string | null =>
  parsed.kind === 'component' ? `${ns.name} ${parsed.number} ${parsed.letter}` : null;

/** An HD or HIP id by the number and letter it names, so `HD 193562` never answers `HD 19356` + `2`, and an unreadable one fails `ledger`; any other id by `identKey`. */
export function replyKey(id: string, ledger: ParseLedger): string | null {
  const ns = LETTERED.find((n) => id.startsWith(n.prefix));
  if (ns === undefined) return identKey(id);
  const parsed = parseIdent(ns, id);
  ledger.note(parsed);
  return letteredKey(ns, parsed);
}

/** Each unresolved component's CCDM id, and its letter on every HD and HIP a resolved sibling holds, by the key a reply joins on; a component no HD or HIP id can letter (`2`, `Aa1`) asks CCDM only. An id two components would ask keeps the first. */
export function cascadeCandidates(
  unresolved: readonly WdsComponent[],
  siblingOids: ReadonlyMap<string, readonly number[]>,
  hdByOid: ReadonlyMap<number, string>,
  hipByOid: ReadonlyMap<number, string>,
): Map<string, CascadeCandidate> {
  const out = new Map<string, CascadeCandidate>();
  const add = (key: string, id: string, component: WdsComponent, strategy: CascadeStrategy): void => {
    if (!out.has(key)) out.set(key, { id, component, strategy });
  };
  const addLettered = (ns: Namespace, number: string | undefined, component: WdsComponent): void => {
    if (number === undefined) return;
    const id = compose(ns, `${number}${component.component}`);
    const key = letteredKey(ns, parseIdent(ns, id));
    if (key !== null) add(key, id, component, ns === HD ? 'HD' : 'HIP');
  };
  for (const c of unresolved) {
    const ccdm = `CCDM J${c.wdsId}${c.component}`;
    add(identKey(ccdm), ccdm, c, 'CCDM');
    for (const oid of siblingOids.get(c.wdsId) ?? []) {
      addLettered(HD, hdByOid.get(oid), c);
      addLettered(HIP, hipByOid.get(oid), c);
    }
  }
  return out;
}

export interface CascadeHit {
  readonly id: string;
  readonly oid: number;
}

export interface CascadeResult {
  /** By `componentId`. */
  readonly recoveries: ReadonlyMap<string, { readonly component: WdsComponent; readonly oid: number }>;
  /** Hits per strategy, each alias row counted, so two strategies may count one recovery. */
  readonly hits: Readonly<Record<CascadeStrategy, number>>;
  /** Components whose aliases named more than one object, each bound to none. */
  readonly conflicts: readonly string[];
}

/** A hit on an object an ident already resolved names that object again, not a new component, and is dropped; aliases naming two objects for one component bind neither, so the reply order decides nothing. */
export function cascadeRecoveries(
  hits: readonly CascadeHit[],
  candidates: ReadonlyMap<string, CascadeCandidate>,
  resolvedOids: ReadonlySet<number>,
  ledger: ParseLedger,
): CascadeResult {
  const named = new Map<string, { component: WdsComponent; byOid: Map<number, { id: string; strategy: CascadeStrategy }[]> }>();
  for (const { id, oid } of hits) {
    const asked = replyKey(id, ledger);
    const candidate = asked === null ? undefined : candidates.get(asked);
    if (candidate === undefined || resolvedOids.has(oid)) continue;
    const key = componentId(candidate.component);
    const entry = named.get(key) ?? { component: candidate.component, byOid: new Map() };
    named.set(key, entry);
    const held = entry.byOid.get(oid);
    if (held === undefined) entry.byOid.set(oid, [{ id, strategy: candidate.strategy }]);
    else held.push({ id, strategy: candidate.strategy });
  }
  const recoveries = new Map<string, { component: WdsComponent; oid: number }>();
  const counts: Record<CascadeStrategy, number> = { HD: 0, CCDM: 0, HIP: 0 };
  const conflicts: string[] = [];
  for (const [key, { component, byOid }] of named) {
    const entries = [...byOid].sort(([a], [b]) => a - b);
    if (entries.length > 1) {
      conflicts.push(`${key}: ${entries.map(([oid, aliases]) => `${oid} (${aliases.map((h) => h.id).join(', ')})`).join(', ')}`);
      continue;
    }
    const [[oid, aliases]] = entries;
    recoveries.set(key, { component, oid });
    for (const { strategy } of aliases) counts[strategy]++;
  }
  return { recoveries, hits: counts, conflicts: conflicts.sort() };
}
