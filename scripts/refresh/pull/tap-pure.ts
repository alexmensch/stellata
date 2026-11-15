// One sync backend for Gaia, VizieR and SIMBAD: TAP over POST /sync, or VizieR's ASU over GET; overflow refused by row count. See README.md#the-tap-backend.

import { parse } from 'csv-parse/sync';

import { readFitsTable } from './fits-pure';

export interface TapMirror {
  readonly name: string;
  readonly url: string;
  /** `asu`: VizieR's ASU interface, asked for FITS, for a mirror that serves no TAP. */
  readonly protocol: 'tap' | 'asu';
  /** False until the live checks in README.md#the-tap-backend pass against it; a committed record it answered fails the suite. */
  readonly verified: boolean;
}

export interface TapArchive {
  readonly mirrors: readonly [TapMirror, ...TapMirror[]];
  /** What a TAP mirror is asked to answer in: `fits` where a text reply would round a stored double. */
  readonly format: 'csv' | 'fits';
  readonly retryDelaysMs: readonly number[];
  readonly quote: (identifier: string) => string;
}

/** A query as an ASU mirror asks it: each archive column under the name it answers as, and `column=value` constraints. */
export interface AsuQuery {
  readonly source: string;
  readonly columns: readonly { readonly archive: string; readonly name: string }[];
  readonly constraints: Readonly<Record<string, string>>;
}

/** A query every mirror of its archive can send: ADQL for TAP, and the ASU form where the archive has an ASU mirror. */
export interface ArchiveQuery {
  readonly adql: string;
  readonly asu?: AsuQuery;
}

const bare = (identifier: string): string => identifier;

export const GAIA_DR3_RELEASE = 'Gaia DR3';

/** The most rows a sliced Gaia pull puts in one slice: at LIMIT_HEADROOM 2 a slice asks 48,001 rows, inside ESA's hard output limit of 50,000. */
export const GAIA_SLICE_ROWS = 24_000;

const ESA_SYNC: TapMirror = { name: 'ESA-sync', protocol: 'tap', verified: true, url: 'https://gea.esac.esa.int/tap-server/tap' };

export const GAIA: TapArchive = {
  mirrors: [ESA_SYNC, { name: 'ARI-sync', protocol: 'tap', verified: true, url: 'https://gaia.ari.uni-heidelberg.de/tap' }],
  format: 'csv',
  retryDelaysMs: [2_000, 4_000, 8_000, 16_000],
  quote: bare,
};

/** For a table only ESA publishes under its query's name: ARI hosts `external.*` under other schema names. */
export const GAIA_ESA: TapArchive = { ...GAIA, mirrors: [ESA_SYNC] };

/** FITS, so a double reaches the TSV as stored: CDS's CSV and CfA's ASU text each round it their own way (README.md#fits-replies). */
export const VIZIER: TapArchive = {
  mirrors: [
    { name: 'CDS', protocol: 'tap', verified: false, url: 'https://tapvizier.u-strasbg.fr/TAPVizieR/tap' },
    { name: 'CfA', protocol: 'asu', verified: false, url: 'https://vizier.cfa.harvard.edu/viz-bin/asu-binfits' },
  ],
  format: 'fits',
  retryDelaysMs: [1_000, 2_000, 4_000],
  quote: (identifier) => `"${identifier}"`,
};

/** Ids per `IN (…)` batch: SIMBAD's TAP accepts about a 64 KB POST body, and 1,000 integer ids are about 20 KB. */
export const SIMBAD_BATCH_SIZE = 1_000;

export const SIMBAD: TapArchive = {
  mirrors: [
    { name: 'SIMBAD-CDS', protocol: 'tap', verified: false, url: 'https://simbad.cds.unistra.fr/simbad/sim-tap' },
    { name: 'SIMBAD-Harvard', protocol: 'tap', verified: true, url: 'https://simbad.cfa.harvard.edu/simbad/sim-tap' },
  ],
  format: 'csv',
  retryDelaysMs: [1_000, 2_000, 4_000],
  quote: bare,
};

export interface HttpReply {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

export const textReply = (status: number, contentType: string, text: string): HttpReply =>
  ({ status, contentType, body: new TextEncoder().encode(text) });

const replyText = (reply: HttpReply): string => new TextDecoder().decode(reply.body);

/** A GET without `form`, a POST with it; a network failure throws. */
export type Transport = (url: string, form?: URLSearchParams) => Promise<HttpReply>;

/** More rows than the query's limit: permanent, since every mirror truncates the same query alike. */
export class TapOverflow extends Error {
  override name = 'TapOverflow';
}

/** The archive refused the query itself, or the reply is not one a retry can change. */
export class TapRefused extends Error {
  override name = 'TapRefused';
}

export class TapTransient extends Error {
  override name = 'TapTransient';
}

export interface TapResult {
  readonly columns: readonly string[];
  /** An empty cell, the archives' masked value, reads `null`. */
  readonly rows: readonly (readonly (string | null)[])[];
}

/** `result` when it holds `limit` rows or fewer, else `TapOverflow`: the query asks for limit + 1, so more means truncated. */
function withinLimit(result: TapResult, limit: number, label: string): TapResult {
  if (result.rows.length > limit) {
    throw new TapOverflow(`${label}: more than ${limit} rows; the result is truncated, so raise the limit or batch the query`);
  }
  return result;
}

export function readCsv(body: string, limit: number, label: string): TapResult {
  const [columns, ...cells] = parse(body, { bom: true }) as string[][];
  if (columns === undefined) throw new TapRefused(`${label}: the reply has no CSV header`);
  return withinLimit({ columns, rows: cells.map((row) => row.map((cell) => (cell === '' ? null : cell))) }, limit, label);
}

const csvCell = (cell: string | null): string => (cell === null ? '' : /[",\n\r]/.test(cell) || cell === '' ? `"${cell.replace(/"/g, '""')}"` : cell);

/** The CSV `readCsv` reads back to the same columns and cells, a null as the empty cell. */
export function csvText(columns: readonly string[], rows: readonly (readonly (string | null)[])[]): string {
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

/** A FITS reply's table, `limit` rows or fewer; a reply cut short is transient. */
function readFits(reply: HttpReply, limit: number, label: string): TapResult | null {
  const table = readFitsTable(reply.body);
  if (table.kind === 'incomplete') throw new TapTransient(`${label}: FITS reply cut short (${table.reason})`);
  return table.kind === 'no-table' ? null : withinLimit({ columns: table.columns, rows: table.rows }, limit, label);
}

/** An ASU reply's leading columns must be the asked ones, in order, renamed to the names they answer as; ASU appends link columns of its own. */
function asuResult(query: AsuQuery, result: TapResult | null, label: string): TapResult {
  const names = query.columns.map((c) => c.name);
  if (result === null) return { columns: names, rows: [] };
  const asked = query.columns.map((c) => c.archive);
  if (asked.some((name, i) => result.columns[i] !== name)) {
    throw new TapRefused(`${label}: ASU answered columns [${result.columns.join(', ')}] for the asked [${asked.join(', ')}]`);
  }
  return { columns: names, rows: result.rows.map((row) => row.slice(0, asked.length)) };
}

const QUERY_STATUS = /<INFO\b[^>]*\bname="QUERY_STATUS"[^>]*\bvalue="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/INFO>)/;
const PERMANENT_FAULT = /unknown column|not found|syntax|invalid|encountered|parse error|unresolved/i;
const DETAIL_CHARS = 400;

/** The VOTable QUERY_STATUS an archive answers a failed query with, whatever FORMAT asked for. */
export function queryStatus(body: string): { readonly value: string; readonly message: string } | null {
  const match = QUERY_STATUS.exec(body);
  return match ? { value: match[1], message: (match[2] ?? '').replace(/\s+/g, ' ').trim() } : null;
}

/** A reply that is not CSV, as the error it carries: refused when the archive's own message names a query fault or the status is a 4xx. */
export function replyError(reply: HttpReply, label: string): TapRefused | TapTransient {
  const body = replyText(reply);
  const status = queryStatus(body);
  const text = body.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  const detail = (status ? `${status.value}: ${status.message}` : text.replace(/\s+/g, ' ').trim()).slice(0, DETAIL_CHARS);
  const report = `${label}: HTTP ${reply.status}, ${detail}`;
  if (status !== null && PERMANENT_FAULT.test(status.message)) return new TapRefused(report);
  return reply.status >= 500 || reply.status < 400 ? new TapTransient(report) : new TapRefused(report);
}

/** The most rows a mirror returns from one sync query, from its `/capabilities`; `null` when it declares none. */
export function hardRowLimit(capabilities: string): number | null {
  const block = /<outputLimit>([\s\S]*?)<\/outputLimit>/.exec(capabilities);
  const hard = block && /<hard\b[^>]*unit="row"[^>]*>\s*(\d+)\s*<\/hard>/.exec(block[1]);
  return hard ? Number(hard[1]) : null;
}

export function syncForm(adql: string, limit: number, format: TapArchive['format']): URLSearchParams {
  return new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: format, MAXREC: String(limit + 1), QUERY: adql });
}

/** The ASU URL for `query`, asking `-out.max` = limit + 1 so a truncated reply shows as one row too many. */
export function asuUrl(mirror: TapMirror, query: AsuQuery, limit: number): string {
  const params = new URLSearchParams({
    '-source': query.source, '-out': query.columns.map((c) => c.archive).join(','), ...query.constraints, '-out.max': String(limit + 1),
  });
  return `${mirror.url}?${params}`;
}

const CONTENT_TYPE: Readonly<Record<TapArchive['format'], RegExp>> = { csv: /^text\/csv\b/i, fits: /^application\/fits\b/i };

const answers = (reply: HttpReply, format: TapArchive['format']): boolean =>
  reply.status >= 200 && reply.status < 300 && CONTENT_TYPE[format].test(reply.contentType);

export interface TapAnswer {
  /** The answer as CSV, whatever the mirror sent: what the checkpoint keeps and `readCsv` replays. */
  readonly body: string;
  readonly result: TapResult;
  /** The mirror that answered. */
  readonly service: string;
}

export interface TapClientDeps {
  readonly transport: Transport;
  readonly sleep: (ms: number) => Promise<void>;
  readonly report: (service: string) => void;
  readonly log: (line: string) => void;
}

export interface TapClient {
  readonly services: readonly string[];
  /** The rows of `query`, at most `limit` of them, from the first mirror that can hold `limit + 1` and answers. */
  query(query: ArchiveQuery, limit: number): Promise<TapAnswer>;
}

export async function withRetry<T>(run: () => Promise<T>, delaysMs: readonly number[], sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (err instanceof TapRefused || err instanceof TapOverflow || attempt >= delaysMs.length) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}

const fatal = (err: unknown): boolean => err instanceof TapRefused || err instanceof TapOverflow;

/** The answering mirror moves to the front, so a mirror that is down costs its retries once per run. */
export function tapClient(archive: TapArchive, deps: TapClientDeps): TapClient {
  const order = [...archive.mirrors];
  const caps = new Map<string, Promise<number | null>>();

  const capOf = (mirror: TapMirror): Promise<number | null> => {
    if (mirror.protocol === 'asu') return Promise.resolve(null);
    let cap = caps.get(mirror.name);
    if (cap === undefined) {
      cap = withRetry(async () => {
        const reply = await deps.transport(`${mirror.url}/capabilities`);
        if (reply.status !== 200) throw new TapTransient(`${mirror.name} /capabilities: HTTP ${reply.status}`);
        return hardRowLimit(replyText(reply));
      }, archive.retryDelaysMs, deps.sleep);
      cap.catch(() => caps.delete(mirror.name));
      caps.set(mirror.name, cap);
    }
    return cap;
  };

  const answered = (mirror: TapMirror, result: TapResult): TapAnswer =>
    ({ body: csvText(result.columns, result.rows), result, service: mirror.name });

  const askTap = async (mirror: TapMirror, adql: string, limit: number): Promise<TapAnswer> => {
    const reply = await deps.transport(`${mirror.url}/sync`, syncForm(adql, limit, archive.format));
    if (!answers(reply, archive.format)) throw replyError(reply, mirror.name);
    if (archive.format === 'csv') {
      const body = replyText(reply);
      return { body, result: readCsv(body, limit, mirror.name), service: mirror.name };
    }
    const result = readFits(reply, limit, mirror.name);
    if (result === null) throw new TapTransient(`${mirror.name}: a TAP FITS reply with no table`);
    return answered(mirror, result);
  };

  const askAsu = async (mirror: TapMirror, query: AsuQuery, limit: number): Promise<TapAnswer> => {
    const reply = await deps.transport(asuUrl(mirror, query, limit));
    if (!answers(reply, 'fits')) throw replyError(reply, mirror.name);
    return answered(mirror, asuResult(query, readFits(reply, limit, mirror.name), mirror.name));
  };

  const ask = (mirror: TapMirror, query: ArchiveQuery, limit: number): Promise<TapAnswer> => {
    if (mirror.protocol === 'tap') return askTap(mirror, query.adql, limit);
    if (query.asu === undefined) throw new TapRefused(`${mirror.name} answers ASU only, and the query has no ASU form: ${query.adql}`);
    return askAsu(mirror, query.asu, limit);
  };

  return {
    services: archive.mirrors.map((m) => m.name),
    async query(query, limit) {
      const tooSmall: string[] = [];
      let lastTransient: unknown = null;
      for (const mirror of [...order]) {
        try {
          const cap = await capOf(mirror);
          if (cap !== null && cap < limit + 1) {
            tooSmall.push(`${mirror.name} (${cap})`);
            continue;
          }
          const answer = await withRetry(() => ask(mirror, query, limit), archive.retryDelaysMs, deps.sleep);
          order.splice(order.indexOf(mirror), 1);
          order.unshift(mirror);
          deps.report(mirror.name);
          return answer;
        } catch (err) {
          if (fatal(err)) throw err;
          deps.log(`  ${mirror.name} unavailable: ${err instanceof Error ? err.message : String(err)}`);
          lastTransient = err;
        }
      }
      if (lastTransient !== null) throw lastTransient;
      throw new TapOverflow(`no mirror returns ${limit + 1} rows from one query (hard limits: ${tooSmall.join(', ')}); batch the query`);
    },
  };
}

const UNVERIFIED = new Set([GAIA, VIZIER, SIMBAD].flatMap((a) => a.mirrors).filter((m) => !m.verified).map((m) => m.name));

/** The mirrors in a record's `answeredBy` that have not passed their live checks. */
export function unverifiedAnswers(answeredBy: readonly string[]): string[] {
  return answeredBy.filter((name) => UNVERIFIED.has(name));
}
