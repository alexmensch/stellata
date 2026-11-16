// An in-memory SIMBAD answering a pull's declared phases, for the suites and the committed-table replay. See README.md.

import type { Row } from '../pull/columns-pure';
import { phaseTemplate, type Ask, type Phase } from '../pull/pull';
import { csvText, textReply, type HttpReply, type TapClientDeps } from '../pull/tap-pure';
import { simbadMatchKey } from './simbad-specs-pure';
import { ascending, compareCodeUnits } from '../../../src/astro-core/order-pure';

/** The tables a fake answers from: each object's ids, its basic cells by SIMBAD column, its flux rows. */
export interface FakeSimbad {
  readonly idents: readonly { readonly oid: number; readonly id: string }[];
  readonly basic: ReadonlyMap<number, Readonly<Record<string, string | null>>>;
  readonly flux?: readonly { readonly oid: number; readonly filter: string; readonly flux: string | null; readonly fluxErr: string | null; readonly bibcode: string | null }[];
  /** Each whole-table phase's rows. */
  readonly wholeTables?: ReadonlyMap<Phase, readonly Row[]>;
}

const literal = (id: string): string => id.replace(/^'(.*)'$/, '$1');
const likePrefixes = (where: string | undefined): string[] => [...(where ?? '').matchAll(/LIKE '([^']*)%'/g)].map((m) => m[1]);
const filters = (where: string | undefined): Set<string> => new Set([...(where ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]));

/** Positions in `idents`, so an answer keeps the fake's own order. */
interface IdentIndex {
  readonly byMatchKey: ReadonlyMap<string, readonly number[]>;
  readonly byOid: ReadonlyMap<number, readonly number[]>;
}

const indexes = new WeakMap<FakeSimbad, IdentIndex>();

function push<K>(into: Map<K, number[]>, key: K, at: number): void {
  const held = into.get(key);
  if (held === undefined) into.set(key, [at]);
  else held.push(at);
}

function identIndex(fake: FakeSimbad): IdentIndex {
  const held = indexes.get(fake);
  if (held !== undefined) return held;
  const byMatchKey = new Map<string, number[]>();
  const byOid = new Map<number, number[]>();
  fake.idents.forEach((ident, at) => {
    push(byMatchKey, simbadMatchKey(ident.id), at);
    push(byOid, ident.oid, at);
  });
  const index = { byMatchKey, byOid };
  indexes.set(fake, index);
  return index;
}

const identsAt = (fake: FakeSimbad, positions: Iterable<number>) => [...new Set(positions)].sort(ascending).map((at) => fake.idents[at]);

export function answer(fake: FakeSimbad, phase: Phase, ids: readonly string[] | undefined): Row[] {
  if (phase.scope.kind === 'whole-table') {
    const rows = fake.wholeTables?.get(phase);
    if (rows === undefined) throw new Error(`the fake holds no rows for ${phase.from}`);
    return [...rows];
  }
  const asked = ids ?? [];
  const names = phase.columns.map((c) => c.name);
  if (phase.from === 'ident' && phase.scope.key === 'id') {
    const { byMatchKey } = identIndex(fake);
    return identsAt(fake, asked.flatMap((id) => byMatchKey.get(simbadMatchKey(literal(id))) ?? [])).map((i) => [String(i.oid), i.id]);
  }
  const oids = new Set(asked.map(Number));
  if (phase.from === 'ident') {
    const prefixes = likePrefixes(phase.where);
    const { byOid } = identIndex(fake);
    return identsAt(fake, [...oids].flatMap((oid) => byOid.get(oid) ?? []))
      .filter((i) => prefixes.some((p) => i.id.startsWith(p)))
      .sort((a, b) => a.oid - b.oid || compareCodeUnits(a.id, b.id))
      .map((i) => [String(i.oid), i.id]);
  }
  if (phase.from === 'flux') {
    const bands = filters(phase.where);
    return (fake.flux ?? []).filter((f) => oids.has(f.oid) && bands.has(f.filter)).map((f) => [String(f.oid), f.filter, f.flux, f.fluxErr, f.bibcode]);
  }
  if (phase.from === 'basic') {
    return [...oids].flatMap((oid) => {
      const cells = fake.basic.get(oid);
      return cells === undefined ? [] : [names.map((name) => (name === 'oid' ? String(oid) : cells[name] ?? null))];
    });
  }
  throw new Error(`the fake answers no ${phase.from} phase`);
}

/** The fake as a pull's `ask`, recording each phase it was asked. */
export function fakeAsk(fake: FakeSimbad): { ask: Ask; asked: { phase: Phase; ids: readonly string[] | undefined }[] } {
  const asked: { phase: Phase; ids: readonly string[] | undefined }[] = [];
  return {
    asked,
    ask: async (phase, ids) => {
      asked.push({ phase, ids });
      return answer(fake, phase, ids);
    },
  };
}

/** The fake behind a TAP transport: each query matched to the declared phase whose template it fills, answered as CSV. */
export function fakeTransport(fake: FakeSimbad, phases: Readonly<Record<string, Phase>>, quote: (id: string) => string): TapClientDeps['transport'] {
  const templates = Object.values(phases).map((phase) => {
    const [head, tail = ''] = phaseTemplate(phase, quote).split('{request}');
    return { phase, head, tail };
  });
  return async (_url, form): Promise<HttpReply> => {
    if (!form) return textReply(200, 'text/xml', '<capabilities/>');
    const adql = form.get('QUERY') ?? '';
    const match = templates.find((t) => (t.phase.scope.kind === 'whole-table' ? adql === t.head : adql.startsWith(t.head) && adql.endsWith(t.tail)));
    if (match === undefined) throw new Error(`the fake matches no declared phase to ${adql.slice(0, 120)}`);
    const ids = match.phase.scope.kind === 'whole-table' ? undefined : adql.slice(match.head.length, adql.length - match.tail.length).split(', ');
    const rows = answer(fake, match.phase, ids);
    return textReply(200, 'text/csv', csvText(match.phase.columns.map((c) => c.name), rows));
  };
}
