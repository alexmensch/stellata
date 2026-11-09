// SIMBAD's four query shapes as pull phases, and the fetchers that fold their replies into oid-keyed maps. See README.md.

import type { Check } from '../../util/emit-artifacts';
import type { Ask, Phase } from '../pull/pull';
import { SIMBAD_BATCH_SIZE } from '../pull/tap-pure';
import {
  GAIA_RELEASES, OID, compose, fluxColumns, likePattern, parseIdent,
  type BasicColumn, type FluxBand, type Namespace, type ParsedIdent,
} from './simbad-specs-pure';

/** The most ids one object holds under one namespace in a batch, on average: sizes an ident batch's limit. */
export const IDENTS_PER_NAMESPACE = 2;

export interface SimbadPhases {
  /** Identifier → oid, by exact id. */
  readonly resolve: Phase;
  readonly basic: Phase;
  /** The shipped namespaces' ids per oid, in id order, so a namespace's last id is the last in that order. */
  readonly idents: Phase;
  /** Every Gaia release's ids per oid, read only by corroboration (README.md#the-corroboration-rule). */
  readonly releases: Phase;
  readonly flux: Phase | null;
}

export interface PhaseSpec {
  readonly basic: readonly [typeof OID, ...BasicColumn[]];
  readonly idents: readonly Namespace[];
  readonly fluxes?: readonly FluxBand[];
}

const byOid = (rowsPerId: number) => ({ kind: 'request', key: 'oidref', batchSize: SIMBAD_BATCH_SIZE, rowsPerId }) as const;

/** Each oid's ids under `namespaces`, ordered by oid then id. */
export function identPhase(namespaces: readonly Namespace[]): Phase {
  return {
    from: 'ident',
    where: namespaces.map((ns) => `id LIKE '${likePattern(ns)}'`).join(' OR '),
    orderBy: 'oidref, id',
    columns: [{ name: 'oidref' }, { name: 'id' }],
    scope: byOid(namespaces.length * IDENTS_PER_NAMESPACE),
  };
}

export function simbadPhases(spec: PhaseSpec): SimbadPhases {
  const fluxes = spec.fluxes ?? [];
  const [first, ...rest] = spec.basic;
  return {
    resolve: {
      from: 'ident',
      columns: [{ name: 'oidref' }, { name: 'id' }],
      scope: { kind: 'request', key: 'id', batchSize: SIMBAD_BATCH_SIZE, rowsPerId: 1 },
    },
    basic: {
      from: 'basic',
      columns: [{ name: first.column }, ...rest.map((c) => ({ name: c.column }))],
      scope: { kind: 'request', key: 'oid', batchSize: SIMBAD_BATCH_SIZE, rowsPerId: 1 },
    },
    idents: identPhase(spec.idents),
    releases: identPhase(GAIA_RELEASES),
    flux: fluxes.length === 0 ? null : {
      from: 'flux',
      where: `filter IN (${fluxes.map((b) => `'${b.filter}'`).join(', ')})`,
      columns: [{ name: 'oidref' }, { name: 'filter' }, { name: 'flux' }, { name: 'flux_err' }, { name: 'bibcode' }],
      scope: byOid(fluxes.length),
    },
  };
}

/** Every phase, named, for a pull's `phases`: what its describe states. */
export function phaseRecord(phases: SimbadPhases): Record<string, Phase> {
  const { flux, ...always } = phases;
  return flux === null ? { ...always } : { ...always, flux };
}

/** Ids under a numeric namespace that carry a component letter are skipped (the bare number is held too); any other unparsable id fails the pull. */
export interface ParseLedger {
  note(parsed: ParsedIdent): void;
  check(label: string): Check;
}

export function parseLedger(): ParseLedger {
  let components = 0;
  const unparsed: string[] = [];
  return {
    note(parsed) {
      if (parsed.kind === 'component') components++;
      else if (parsed.kind === 'unparsed') unparsed.push(parsed.id);
    },
    check(label) {
      const report = `${label}: ${components} component-lettered ids skipped, ${unparsed.length} unparsable`;
      return unparsed.length === 0
        ? { kind: 'pass', report }
        : { kind: 'fail', message: `${report}: ${unparsed.slice(0, 20).join(', ')} — an id shape the namespace rules do not know`, report };
    },
  };
}

const QUOTABLE_SUFFIX = /^[A-Za-z0-9 .+-]+$/;

export const oidOf = (cell: string | null): number => {
  if (cell === null || !/^\d+$/.test(cell)) throw new Error(`a SIMBAD oid "${cell ?? ''}" is not an integer`);
  return Number(cell);
};

const text = (cell: string | null): string => cell ?? '';

/** Each suffix SIMBAD holds under `ns`, to its oid. A suffix answering under two oids is an error: an id names one object. */
export async function resolveOids(
  ask: Ask, phases: SimbadPhases, ns: Namespace, suffixes: readonly string[], ledger: ParseLedger,
): Promise<Map<string, number>> {
  const refused = suffixes.filter((s) => !QUOTABLE_SUFFIX.test(s));
  if (refused.length > 0) {
    throw new Error(`${refused.length} ${ns.prefix.trim()} suffixes carry characters an ADQL literal cannot hold (first: ${JSON.stringify(refused[0])})`);
  }
  const out = new Map<string, number>();
  const duplicates: string[] = [];
  for (const [oidCell, id] of await ask(phases.resolve, suffixes.map((s) => `'${compose(ns, s)}'`))) {
    const parsed = parseIdent(ns, text(id));
    ledger.note(parsed);
    if (parsed.kind !== 'suffix') continue;
    const oid = oidOf(oidCell);
    const held = out.get(parsed.suffix);
    if (held !== undefined && held !== oid) duplicates.push(`${compose(ns, parsed.suffix)} → ${held} and ${oid}`);
    out.set(parsed.suffix, oid);
  }
  if (duplicates.length > 0) throw new Error(`SIMBAD answers ${duplicates.length} ids under two objects: ${duplicates.slice(0, 20).join('; ')}`);
  return out;
}

export type BasicCells = Readonly<Record<string, string | null>>;

/** Each oid's basic-table cells, keyed by SIMBAD's column name. */
export async function fetchBasic(ask: Ask, phases: SimbadPhases, oids: readonly number[]): Promise<Map<number, BasicCells>> {
  const names = phases.basic.columns.map((c) => c.name);
  const out = new Map<number, BasicCells>();
  for (const row of await ask(phases.basic, oids.map(String))) {
    out.set(oidOf(row[0]), Object.fromEntries(names.map((name, i) => [name, row[i]])));
  }
  return out;
}

type IdentRows = Awaited<ReturnType<Ask>>;

function foldIdents<T>(rows: IdentRows, namespaces: readonly Namespace[], ledger: ParseLedger, fold: (into: Map<string, T>, ns: string, suffix: string) => void) {
  const out = new Map<number, Map<string, T>>();
  for (const [oidCell, idCell] of rows) {
    const id = text(idCell);
    const ns = namespaces.find((n) => id.startsWith(n.prefix));
    if (ns === undefined) continue;
    const parsed = parseIdent(ns, id);
    ledger.note(parsed);
    if (parsed.kind !== 'suffix') continue;
    const oid = oidOf(oidCell);
    let held = out.get(oid);
    if (held === undefined) out.set(oid, held = new Map());
    fold(held, ns.name, parsed.suffix);
  }
  return out;
}

/** One id per namespace per oid: the last in id order, since the shipped column holds one. */
export async function fetchIdents(
  ask: Ask, phases: SimbadPhases, namespaces: readonly Namespace[], oids: readonly number[], ledger: ParseLedger,
): Promise<Map<number, Map<string, string>>> {
  return foldIdents<string>(await ask(phases.idents, oids.map(String)), namespaces, ledger, (into, ns, suffix) => { into.set(ns, suffix); });
}

/** Every Gaia release's ids per oid: corroboration asks whether an id is held at all, so it keeps every one. */
export async function fetchReleaseIds(
  ask: Ask, phases: SimbadPhases, oids: readonly number[], ledger: ParseLedger,
): Promise<Map<number, Map<string, Set<string>>>> {
  return foldIdents<Set<string>>(await ask(phases.releases, oids.map(String)), GAIA_RELEASES, ledger, (into, ns, suffix) => {
    let held = into.get(ns);
    if (held === undefined) into.set(ns, held = new Set());
    held.add(suffix);
  });
}

/** The long `flux` table pivoted wide: each oid's `flux_<F>`, `flux_<F>_err`, `flux_<F>_bibcode` cells. */
export async function fetchFlux(
  ask: Ask, phases: SimbadPhases, bands: readonly FluxBand[], oids: readonly number[],
): Promise<Map<number, Record<string, string | null>>> {
  const out = new Map<number, Record<string, string | null>>();
  if (phases.flux === null) return out;
  const source = { flux: 2, flux_err: 3, bibcode: 4 } as const;
  for (const row of await ask(phases.flux, oids.map(String))) {
    const band = bands.find((b) => b.filter === text(row[1]).trim());
    if (band === undefined) throw new Error(`SIMBAD answered a flux row in band "${text(row[1])}", which the query did not ask for`);
    const oid = oidOf(row[0]);
    let cells = out.get(oid);
    if (cells === undefined) out.set(oid, cells = {});
    for (const c of fluxColumns(band)) cells[c.tsv] = row[source[c.source]];
  }
  return out;
}
