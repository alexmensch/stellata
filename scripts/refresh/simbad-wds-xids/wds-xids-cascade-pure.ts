// The HD / CCDM / HIP alias cascade for WDS components SIMBAD holds under no WDS ident, and the HIP an object's aliases name. See README.md#the-run.

import type { ParseLedger } from '../simbad/simbad-fetch-pure';
import { HIP, compose, parseIdent, type Namespace } from '../simbad/simbad-specs-pure';
import { componentId, type WdsComponent } from './wds-components-pure';

export const CASCADE_STRATEGIES = ['HD', 'CCDM', 'HIP'] as const;
export type CascadeStrategy = (typeof CASCADE_STRATEGIES)[number];

/** SIMBAD right-aligns an HD number in seven characters (`HD  48915`, `HD    113`), and a component's id appends its letter. */
export const HD_FIELD_WIDTH = 7;

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
  readonly component: WdsComponent;
  readonly strategy: CascadeStrategy;
}

/** Each unresolved component's CCDM id, and its letter on every HD and HIP a resolved sibling holds. An id two components would ask keeps the first. */
export function cascadeCandidates(
  unresolved: readonly WdsComponent[],
  siblingOids: ReadonlyMap<string, readonly number[]>,
  hdByOid: ReadonlyMap<number, string>,
  hipByOid: ReadonlyMap<number, string>,
): Map<string, CascadeCandidate> {
  const out = new Map<string, CascadeCandidate>();
  const add = (id: string, component: WdsComponent, strategy: CascadeStrategy): void => {
    if (!out.has(id)) out.set(id, { component, strategy });
  };
  for (const c of unresolved) {
    add(`CCDM J${c.wdsId}${c.component}`, c, 'CCDM');
    for (const oid of siblingOids.get(c.wdsId) ?? []) {
      const hd = hdByOid.get(oid);
      if (hd !== undefined) add(`HD${hd.padStart(HD_FIELD_WIDTH, ' ')}${c.component}`, c, 'HD');
      const number = hipByOid.get(oid);
      if (number !== undefined) {
        add(compose(HIP, `${number}${c.component}`), c, 'HIP');
        add(compose(HIP, `${number} ${c.component}`), c, 'HIP');
      }
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
  /** Components a later alias named a different object for than the first. */
  readonly conflicts: readonly string[];
}

/** Hits in the order given; one on an object an ident already resolved names that object again, not a new component, and is dropped. */
export function cascadeRecoveries(
  hits: readonly CascadeHit[],
  candidates: ReadonlyMap<string, CascadeCandidate>,
  resolvedOids: ReadonlySet<number>,
): CascadeResult {
  const recoveries = new Map<string, { component: WdsComponent; oid: number }>();
  const counts: Record<CascadeStrategy, number> = { HD: 0, CCDM: 0, HIP: 0 };
  const conflicts: string[] = [];
  for (const { id, oid } of hits) {
    const candidate = candidates.get(id);
    if (candidate === undefined || resolvedOids.has(oid)) continue;
    const key = componentId(candidate.component);
    const held = recoveries.get(key);
    if (held !== undefined && held.oid !== oid) {
      conflicts.push(`${key}: ${held.oid}, then ${oid} (${id})`);
      continue;
    }
    recoveries.set(key, { component: candidate.component, oid });
    counts[candidate.strategy]++;
  }
  return { recoveries, hits: counts, conflicts };
}
