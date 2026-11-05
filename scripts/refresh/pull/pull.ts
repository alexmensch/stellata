// A TypeScript pull: its tables queried through one TAP backend with a resume cache, gated, and written all or none. See README.md.

import { setTimeout as sleep } from 'node:timers/promises';

import { reportService } from '../../util/answered-by';
import { emitArtifacts, type Check, type DeclaredOutputs, type PullDescription } from '../../util/emit-artifacts';
import { checkpoint } from './checkpoint';
import { cellReader, checkedRows, formatTsv, projection, type Column, type Row } from './columns-pure';
import { bandCheck, coverageCheck, spotRowCheck, type Coverage, type RowBand, type SpotRow } from './gates-pure';
import { readCsv, tapClient, type TapArchive, type TapClientDeps, type Transport } from './tap-pure';

export type Scope =
  | { readonly kind: 'whole-table' }
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
  };

export interface PullTable {
  readonly from: string;
  readonly where?: string;
  readonly orderBy?: string;
  readonly columns: readonly [Column, ...Column[]];
  readonly scope: Scope;
  readonly band: RowBand;
  readonly spotRows: readonly [SpotRow, ...SpotRow[]];
}

export interface Pull<K extends string> {
  readonly archive: TapArchive;
  readonly outputs: DeclaredOutputs<K>;
  readonly tables: Readonly<Record<K, PullTable>>;
  readonly release?: string;
}

/** A query's limit over the rows it should return, so the band, not the overflow, reports a moved table. */
export const LIMIT_HEADROOM = 2;
const REQUEST = '{request}';
const SYNC_TIMEOUT_MS = 300_000;

/** The table's ADQL with the request ids left as `{request}`: the text a pull's query hash covers. */
export function queryTemplate(table: PullTable, quote: TapArchive['quote']): string {
  const scoped = table.scope.kind === 'request' ? `${table.scope.key} IN (${REQUEST})` : undefined;
  const where = table.where && scoped ? `(${table.where}) AND ${scoped}` : table.where ?? scoped;
  return [
    `SELECT ${projection(table.columns, quote)} FROM ${table.from}`,
    ...(where ? [`WHERE ${where}`] : []),
    ...(table.orderBy ? [`ORDER BY ${table.orderBy}`] : []),
  ].join(' ');
}

export function queryLimit(table: PullTable): number {
  const expected = table.scope.kind === 'request' ? table.scope.batchSize * table.scope.rowsPerId : table.band.max;
  return expected * LIMIT_HEADROOM;
}

export function batchQueries(table: PullTable, quote: TapArchive['quote']): string[] {
  const template = queryTemplate(table, quote);
  const { scope } = table;
  if (scope.kind === 'whole-table') return [template];
  const batches: string[] = [];
  for (let at = 0; at < scope.ids.length; at += scope.batchSize) {
    batches.push(template.replace(REQUEST, scope.ids.slice(at, at + scope.batchSize).join(', ')));
  }
  return batches;
}

const keysOf = <K extends string>(pull: Pull<K>): K[] => Object.keys(pull.tables) as K[];

export function describePull<K extends string>(pull: Pull<K>): PullDescription {
  const queries = Object.fromEntries(keysOf(pull).map((k) => [k, queryTemplate(pull.tables[k], pull.archive.quote)]));
  return {
    query: JSON.stringify(queries),
    services: pull.archive.mirrors.map((m) => m.name),
    ...(pull.release === undefined ? {} : { release: pull.release }),
  };
}

const fetchTransport: Transport = async (url, form) => {
  const response = await fetch(url, {
    method: form ? 'POST' : 'GET',
    body: form,
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() };
};

export const LIVE: TapClientDeps = { transport: fetchTransport, sleep: (ms) => sleep(ms), report: reportService, log: console.log };

function tableChecks(label: string, table: PullTable, rows: readonly Row[]): Check[] {
  const cells = rows.map(cellReader(table.columns, label));
  const { scope } = table;
  return [
    bandCheck(label, rows.length, table.band),
    spotRowCheck(label, cells, table.spotRows),
    ...(scope.kind === 'request' && scope.coverage ? [coverageCheck(label, cells, scope.idColumn, scope.ids.length, scope.coverage)] : []),
  ];
}

/** The resume cache sits beside the first output and goes only once every output has landed. */
export async function runPull<K extends string>(pull: Pull<K>, deps: TapClientDeps = LIVE): Promise<void> {
  const keys = keysOf(pull);
  const cache = checkpoint(`${pull.outputs.files[keys[0]]}.ckpt`);
  const client = tapClient(pull.archive, deps);
  const files = {} as Record<K, string>;
  const checks: Check[] = [];
  for (const key of keys) {
    const table = pull.tables[key];
    const limit = queryLimit(table);
    const batches = batchQueries(table, pull.archive.quote);
    const rows: Row[] = [];
    for (const [i, adql] of batches.entries()) {
      const cached = cache.load(adql);
      const result = cached === null ? await client.query(adql, limit) : { body: cached, result: readCsv(cached, limit, key) };
      if (cached === null) cache.save(adql, result.body);
      for (const row of checkedRows(table.columns, result.result, key)) rows.push(row);
      deps.log(`  ${key} batch ${i + 1}/${batches.length}: ${result.result.rows.length} rows${cached === null ? '' : ' from checkpoint'} (total ${rows.length})`);
    }
    checks.push(...tableChecks(key, table, rows));
    files[key] = formatTsv(pull.outputs.files[key], table.columns, rows);
  }
  emitArtifacts({ outputs: pull.outputs, files, checks });
  cache.clear();
}
