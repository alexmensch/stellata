// An in-memory SIMBAD answering a pull's declared phases, for the suites and the committed-table replay. See README.md.

import type { Row } from '../pull/columns-pure';
import { phaseTemplate, type Ask, type Phase } from '../pull/pull';
import type { HttpReply, TapClientDeps } from '../pull/tap-pure';
import { simbadMatchKey } from './simbad-specs-pure';

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

export function answer(fake: FakeSimbad, phase: Phase, ids: readonly string[] | undefined): Row[] {
  if (phase.scope.kind === 'whole-table') {
    const rows = fake.wholeTables?.get(phase);
    if (rows === undefined) throw new Error(`the fake holds no rows for ${phase.from}`);
    return [...rows];
  }
  const asked = ids ?? [];
  const names = phase.columns.map((c) => c.name);
  if (phase.from === 'ident' && phase.scope.key === 'id') {
    const wanted = new Set(asked.map((id) => simbadMatchKey(literal(id))));
    return fake.idents.filter((i) => wanted.has(simbadMatchKey(i.id))).map((i) => [String(i.oid), i.id]);
  }
  const oids = new Set(asked.map(Number));
  if (phase.from === 'ident') {
    const prefixes = likePrefixes(phase.where);
    return fake.idents
      .filter((i) => oids.has(i.oid) && prefixes.some((p) => i.id.startsWith(p)))
      .sort((a, b) => a.oid - b.oid || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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

const csvCell = (cell: string | null): string => (cell === null ? '' : /[",\n\r]/.test(cell) || cell === '' ? `"${cell.replace(/"/g, '""')}"` : cell);

export function csvText(names: readonly string[], rows: readonly Row[]): string {
  return [names, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

/** The fake behind a TAP transport: each query matched to the declared phase whose template it fills, answered as CSV. */
export function fakeTransport(fake: FakeSimbad, phases: Readonly<Record<string, Phase>>, quote: (id: string) => string): TapClientDeps['transport'] {
  const templates = Object.values(phases).map((phase) => {
    const [head, tail = ''] = phaseTemplate(phase, quote).split('{request}');
    return { phase, head, tail };
  });
  return async (_url, form): Promise<HttpReply> => {
    if (!form) return { status: 200, contentType: 'text/xml', body: '<capabilities/>' };
    const adql = form.get('QUERY') ?? '';
    const match = templates.find((t) => (t.phase.scope.kind === 'whole-table' ? adql === t.head : adql.startsWith(t.head) && adql.endsWith(t.tail)));
    if (match === undefined) throw new Error(`the fake matches no declared phase to ${adql.slice(0, 120)}`);
    const ids = match.phase.scope.kind === 'whole-table' ? undefined : adql.slice(match.head.length, adql.length - match.tail.length).split(', ');
    const rows = answer(fake, match.phase, ids);
    return { status: 200, contentType: 'text/csv', body: csvText(match.phase.columns.map((c) => c.name), rows) };
  };
}
