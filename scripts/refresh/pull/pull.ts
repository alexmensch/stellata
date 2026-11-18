// A TypeScript pull: its queries asked through one TAP backend with a resume cache, its tables gated and written all or none. See README.md.

import { setTimeout as sleep } from 'node:timers/promises';

import { reportService } from '../../util/answered-by';
import { emitArtifacts, type Check, type DeclaredOutputs, type Projection, type PullDescription } from '../../util/emit-artifacts';
import { checkpoint } from './checkpoint';
import {
  cellReader, checkedRows, formatTsv, projection, sortRows, type Column, type Row, type SortKey,
} from './columns-pure';
import { bandCheck, coverageCheck, spotRowCheck, type Coverage, type RowBand, type SpotRow } from './gates-pure';
import { sliceConditions, type SliceEdges } from './slices-pure';
import {
  mirrorForms, readCsv, tapClient, type ArchiveQuery, type AsuQuery, type TapAnswer, type TapArchive, type TapResult, type TapClientDeps, type Transport,
} from './tap-pure';

/** A whole table in one query; `asu` is that query as an ASU mirror asks it, required where the archive has one. */
interface WholeTable {
  readonly kind: 'whole-table';
  readonly asu?: AsuQuery;
}

export type Scope =
  | WholeTable
  | {
    readonly kind: 'request';
    /** The ADQL column the request ids match. */
    readonly key: string;
    /** The declared column that answers with the request id. */
    readonly idColumn: string;
    /** ADQL literals, quoted where the column is text. */
    readonly ids: readonly string[];
    readonly batchSize: number;
    readonly rowsPerId: number;
    readonly coverage?: Coverage;
  }
  | SlicedScope;

/** A table partitioned into half-open key ranges (README.md#sliced-scope). */
export interface SlicedScope {
  readonly kind: 'sliced';
  /** The ADQL column the slices partition; a row whose key is null is in no slice. */
  readonly key: string;
  /** Strictly increasing, cut from the table by `cutEdges`. */
  readonly edges: SliceEdges;
  /** The most rows any slice is expected to hold. */
  readonly sliceRows: number;
}

/** What a written table is held to and written in. */
export interface WrittenTable {
  readonly columns: readonly [Column, ...Column[]];
  /** The written order, over every batch: an archive's row order is not stable across runs. */
  readonly sortBy: readonly [SortKey, ...SortKey[]];
  readonly band: RowBand;
  readonly spotRows: readonly [SpotRow, ...SpotRow[]];
}

export interface PullTable extends WrittenTable {
  readonly from: string;
  readonly where?: string;
  /** A server-side order, for a query that needs one (a `TOP`); the written order is `sortBy`'s. */
  readonly orderBy?: string;
  readonly scope: Scope;
}

export interface Pull<K extends string> {
  readonly archive: TapArchive;
  readonly outputs: DeclaredOutputs<K>;
  readonly tables: Readonly<Record<K, PullTable>>;
  readonly release?: string;
}

/** A phase's ids come at run time, from earlier answers; a whole-table or sliced phase states the most rows it may return, all queries together. */
export type PhaseScope =
  | WholeTable & { readonly maxRows: number }
  | { readonly kind: 'request'; readonly key: string; readonly batchSize: number; readonly rowsPerId: number }
  | SlicedScope & { readonly maxRows: number };

export interface Phase {
  readonly from: string;
  readonly where?: string;
  readonly orderBy?: string;
  readonly columns: readonly [Column, ...Column[]];
  readonly scope: PhaseScope;
}

/** The header-checked rows of every batch of `phase`, `ids` being ADQL literals for a request-scoped one. */
export type Ask = (phase: Phase, ids?: readonly string[]) => Promise<Row[]>;

export interface PhasedResult<K extends string> {
  readonly rows: Readonly<Record<K, readonly Row[]>>;
  /** Gates the run itself computed (a resolution floor, a parse ledger), beside each table's band and spot rows. */
  readonly checks: readonly Check[];
}

/** A pull whose later queries depend on earlier answers. It may ask only the phases it declares, so its describe states every query it can send. */
export interface PhasedPull<K extends string> {
  readonly archive: TapArchive;
  readonly outputs: DeclaredOutputs<K>;
  readonly phases: Readonly<Record<string, Phase>>;
  readonly tables: Readonly<Record<K, WrittenTable>>;
  readonly release?: string;
  /** The keys the run derives its first request from, and the files they come off (../../pipeline/README.md#freshness--one-mechanism). */
  readonly request?: Projection;
  /** What decides the bytes besides the queries and formats (a seed, a draw's targets), so a change to it stales the record. */
  readonly parameters?: object;
  run(ask: Ask, log: (line: string) => void): Promise<PhasedResult<K>>;
}

/** A query's limit over the rows it should return, so the band, not the overflow, reports a moved table. */
export const LIMIT_HEADROOM = 2;
/** The most cells one whole or sliced table may hold within the CI heap budget: README.md#how-big-a-table-may-be. */
export const MAX_TABLE_CELLS = 60_000_000;
const REQUEST = '{request}';
const SLICE = '{slice}';
const SYNC_TIMEOUT_MS = 300_000;

interface QueryText {
  readonly from: string;
  readonly where?: string;
  readonly orderBy?: string;
  readonly columns: readonly Column[];
}

function batchCondition(scope: PhaseScope): string | undefined {
  if (scope.kind === 'request') return `${scope.key} IN (${REQUEST})`;
  return scope.kind === 'sliced' ? SLICE : undefined;
}

function template(query: QueryText, scope: PhaseScope, quote: TapArchive['quote']): string {
  const scoped = batchCondition(scope);
  const where = query.where && scoped ? `(${query.where}) AND ${scoped}` : query.where ?? scoped;
  return [
    `SELECT ${projection(query.columns, quote)} FROM ${query.from}`,
    ...(where ? [`WHERE ${where}`] : []),
    ...(query.orderBy ? [`ORDER BY ${query.orderBy}`] : []),
  ].join(' ');
}

function batches(text: string, ids: readonly string[], batchSize: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < ids.length; at += batchSize) out.push(text.replace(REQUEST, ids.slice(at, at + batchSize).join(', ')));
  return out;
}

/** A static table as the phase that asks it: a whole or sliced table holds at most its band's ceiling. */
function phaseOf(table: PullTable): Phase {
  const { scope } = table;
  return {
    ...table,
    scope: scope.kind === 'whole-table' ? { ...scope, maxRows: table.band.max }
      : scope.kind === 'sliced' ? { ...scope, maxRows: table.band.max }
        : { kind: 'request', key: scope.key, batchSize: scope.batchSize, rowsPerId: scope.rowsPerId },
  };
}

/** The phase's ADQL with the request ids left as `{request}` and a slice's range as `{slice}`: the text a pull's query hash covers. */
export function phaseTemplate(phase: Phase, quote: TapArchive['quote']): string {
  return template(phase, phase.scope, quote);
}

export const queryTemplate = (table: PullTable, quote: TapArchive['quote']): string => phaseTemplate(phaseOf(table), quote);

export function phaseLimit(phase: Phase): number {
  const { scope } = phase;
  const expected = scope.kind === 'request' ? scope.batchSize * scope.rowsPerId : scope.kind === 'sliced' ? scope.sliceRows : scope.maxRows;
  return expected * LIMIT_HEADROOM;
}

export const queryLimit = (table: PullTable): number => phaseLimit(phaseOf(table));

export function phaseQueries(phase: Phase, ids: readonly string[] | undefined, quote: TapArchive['quote']): string[] {
  const text = phaseTemplate(phase, quote);
  const { scope } = phase;
  if (scope.kind !== 'request') {
    if (ids !== undefined) throw new Error(`a ${scope.kind} phase takes no request ids: ${text}`);
    return scope.kind === 'sliced' ? sliceConditions(scope.key, scope.edges).map((range) => text.replace(SLICE, range)) : [text];
  }
  if (ids === undefined) throw new Error(`a request-scoped phase needs its ids: ${text}`);
  return batches(text, ids, scope.batchSize);
}

export function batchQueries(table: PullTable, quote: TapArchive['quote']): string[] {
  return phaseQueries(phaseOf(table), table.scope.kind === 'request' ? table.scope.ids : undefined, quote);
}

/** Each query `phase` sends, its ASU form beside the ADQL where it has one: a whole-table phase sends one query. */
function archiveQueries(phase: Phase, ids: readonly string[] | undefined, quote: TapArchive['quote']): ArchiveQuery[] {
  const asu = phase.scope.kind === 'whole-table' ? phase.scope.asu : undefined;
  return phaseQueries(phase, ids, quote).map((adql) => (asu === undefined ? { adql } : { adql, asu }));
}

/** Refuses, before any query, a phase an ASU mirror of the archive could not ask. */
function assertAsuForms(archive: TapArchive, phases: Readonly<Record<string, Phase>>): void {
  const asu = archive.mirrors.find((m) => m.protocol === 'asu');
  if (asu === undefined) return;
  const missing = Object.entries(phases).filter(([, p]) => p.scope.kind !== 'whole-table' || p.scope.asu === undefined).map(([name]) => name);
  if (missing.length > 0) throw new Error(`${asu.name} answers ASU only, and these phases have no ASU form: ${missing.join(', ')}`);
}

const keysOf = <K extends string>(record: Readonly<Record<K, unknown>>): K[] => Object.keys(record) as K[];

const formatsOf = (table: WrittenTable): object => Object.fromEntries(table.columns.flatMap((c) => (c.format ? [[c.name, c.format]] : [])));

const asuOf = (scope: Scope | PhaseScope): { asu?: AsuQuery } => (scope.kind === 'whole-table' && scope.asu ? { asu: scope.asu } : {});

/** A query besides its template: a sliced scope's ranges, a whole table's ASU form, and each mirror's differing template. */
function queryExtras(scope: Scope | PhaseScope, template: string, archive: TapArchive): object {
  const mirrors = mirrorForms(archive, template);
  return {
    ...(scope.kind === 'sliced' ? { slices: sliceConditions(scope.key, scope.edges) } : {}),
    ...asuOf(scope),
    ...(Object.keys(mirrors).length > 0 ? { mirrors } : {}),
  };
}

/** Everything besides the data that decides a table's bytes, so a change to any of it stales the pull's record. */
function tableDescription(table: PullTable, archive: TapArchive): object {
  const query = queryTemplate(table, archive.quote);
  return { query, ...queryExtras(table.scope, query, archive), formats: formatsOf(table), sortBy: table.sortBy };
}

function phaseDescription(phase: Phase, archive: TapArchive): object | string {
  const query = phaseTemplate(phase, archive.quote);
  const extras = queryExtras(phase.scope, query, archive);
  return Object.keys(extras).length > 0 ? { query, ...extras } : query;
}

const archiveDescription = (archive: TapArchive, release: string | undefined): Pick<PullDescription, 'services' | 'release'> => ({
  services: archive.mirrors.map((m) => m.name),
  ...(release === undefined ? {} : { release }),
});

export function describePull<K extends string>(pull: Pull<K>): PullDescription {
  const queries = Object.fromEntries(keysOf(pull.tables).map((k) => [k, tableDescription(pull.tables[k], pull.archive)]));
  return { query: JSON.stringify(queries), ...archiveDescription(pull.archive, pull.release) };
}

export function describePhasedPull<K extends string>(pull: PhasedPull<K>): PullDescription & Partial<Projection> {
  const phases = Object.fromEntries(Object.entries(pull.phases).map(([name, p]) => [name, phaseDescription(p, pull.archive)]));
  const tables = Object.fromEntries(keysOf(pull.tables).map((k) => [k, { formats: formatsOf(pull.tables[k]), sortBy: pull.tables[k].sortBy }]));
  const query = { phases, tables, ...(pull.parameters === undefined ? {} : { parameters: pull.parameters }) };
  return { query: JSON.stringify(query), ...archiveDescription(pull.archive, pull.release), ...pull.request };
}

const fetchTransport: Transport = async (url, form) => {
  const response = await fetch(url, {
    method: form ? 'POST' : 'GET',
    body: form,
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: new Uint8Array(await response.arrayBuffer()) };
};

export const LIVE: TapClientDeps = { transport: fetchTransport, sleep: (ms) => sleep(ms), report: reportService, log: console.log };

/** The most rows a whole or sliced phase can hold: every query at its limit, or `ask`'s refusal past `maxRows`, which lets at most one more query's limit in. */
function heldRows(phase: Phase, scope: Exclude<PhaseScope, { kind: 'request' }>, quote: TapArchive['quote']): number {
  const limit = phaseLimit(phase);
  return Math.min(phaseQueries(phase, undefined, quote).length * limit, scope.maxRows + limit);
}

/** Refuses, before any query, a whole or sliced phase whose held rows could exceed `MAX_TABLE_CELLS`; a request-scoped one is bounded per batch. */
function assertPhasesFit(phases: Readonly<Record<string, Phase>>, quote: TapArchive['quote']): void {
  for (const [name, phase] of Object.entries(phases)) {
    if (phase.scope.kind === 'request') continue;
    const cells = heldRows(phase, phase.scope, quote) * phase.columns.length;
    if (cells > MAX_TABLE_CELLS) {
      throw new Error(`${name}: ${phase.scope.kind} rows of up to ${cells} cells exceed ${MAX_TABLE_CELLS}; slice the table finer or narrow its columns`);
    }
  }
}

export function assertTablesFit<K extends string>(pull: Pull<K>): void {
  assertPhasesFit(phased(pull).phases, pull.archive.quote);
}

/** The static pull as phases: one per table, each asked once with its own ids, its coverage computed over them. */
function phased<K extends string>(pull: Pull<K>): PhasedPull<K> {
  const phases = Object.fromEntries(keysOf(pull.tables).map((k) => [k, phaseOf(pull.tables[k])])) as Record<K, Phase>;
  return {
    ...pull,
    phases,
    async run(ask) {
      const rows = {} as Record<K, Row[]>;
      const checks: Check[] = [];
      for (const key of keysOf(pull.tables)) {
        const { scope, columns } = pull.tables[key];
        rows[key] = await ask(phases[key], scope.kind === 'request' ? scope.ids : undefined);
        if (scope.kind === 'request' && scope.coverage) {
          checks.push(coverageCheck(key, rows[key].map(cellReader(columns, key)), scope.idColumn, scope.ids.length, scope.coverage));
        }
      }
      return { rows, checks };
    },
  };
}

export const runPull = <K extends string>(pull: Pull<K>, deps: TapClientDeps = LIVE): Promise<void> => runPhasedPull(phased(pull), deps);

/** Which mirror answered, in the archive's terms: its first mirror, or the fallbacks it was unreachable for; `answered` in first-answer order. */
export function answeredLine(archive: TapArchive, answered: readonly string[]): string {
  const [primary] = archive.mirrors;
  if (answered.length === 0) return 'no archive answered: every reply replayed from a seeded checkpoint';
  const fallbacks = answered.filter((name) => name !== primary.name);
  if (fallbacks.length === 0) return `answered by ${primary.name}`;
  const mirrors = `${fallbacks.join(' and ')} mirror${fallbacks.length > 1 ? 's' : ''}`;
  return answered.includes(primary.name)
    ? `answered by ${primary.name} and the ${mirrors}`
    : `${primary.name} unreachable, answered by ${mirrors}`;
}

/** The resume cache sits beside the first output and goes only once every output has landed. */
export async function runPhasedPull<K extends string>(pull: PhasedPull<K>, deps: TapClientDeps = LIVE): Promise<void> {
  assertPhasesFit(pull.phases, pull.archive.quote);
  assertAsuForms(pull.archive, pull.phases);
  const named = new Map(Object.entries(pull.phases).map(([name, phase]) => [phase, name]));
  const keys = keysOf(pull.tables);
  const cache = checkpoint(`${pull.outputs.files[keys[0]]}.ckpt`);
  const answered: string[] = [];
  const report = (service: string): void => {
    if (!answered.includes(service)) answered.push(service);
    deps.report(service);
  };
  const client = tapClient(pull.archive, { ...deps, report });

  const ask: Ask = async (phase, ids) => {
    const name = named.get(phase);
    if (name === undefined) throw new Error('a phase the pull does not declare cannot be asked: its describe would not state it');
    const limit = phaseLimit(phase);
    const queries = archiveQueries(phase, ids, pull.archive.quote);
    const rows: Row[] = [];
    for (const [i, query] of queries.entries()) {
      const forms = [query.adql, ...Object.values(mirrorForms(pull.archive, query.adql))];
      const cached = forms.map((text) => cache.load(text)).find((c) => c !== null) ?? null;
      let answer: TapAnswer | null = null;
      let result: TapResult;
      if (cached === null) {
        answer = await client.query(query, limit);
        result = answer.result;
      } else {
        if (cached.service) report(cached.service);
        result = readCsv(cached.body, limit, name);
      }
      const checked = checkedRows(phase.columns, result, name);
      if (answer !== null) cache.save(answer.sent, answer);
      for (const row of checked) rows.push(row);
      deps.log(`  ${name} batch ${i + 1}/${queries.length}: ${result.rows.length} rows${cached === null ? '' : ' from checkpoint'} (total ${rows.length})`);
      if (phase.scope.kind !== 'request' && rows.length > phase.scope.maxRows) {
        throw new Error(`${name}: ${rows.length} rows after query ${i + 1} of ${queries.length}, past the ${phase.scope.maxRows} it may hold; the upstream table or the query moved`);
      }
    }
    return rows;
  };

  const result = await pull.run(ask, deps.log);
  const files = {} as Record<K, string>;
  const checks: Check[] = [...result.checks];
  for (const key of keys) {
    const table = pull.tables[key];
    const rows = result.rows[key];
    checks.push(bandCheck(key, rows.length, table.band), spotRowCheck(key, rows.map(cellReader(table.columns, key)), table.spotRows));
    files[key] = formatTsv(pull.outputs.files[key], table.columns, sortRows(table.columns, rows, table.sortBy, key));
  }
  emitArtifacts({ outputs: pull.outputs, files, checks });
  cache.clear();
  deps.log(answeredLine(pull.archive, answered));
}
