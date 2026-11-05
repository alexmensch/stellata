// One TAP sync backend for Gaia, VizieR and SIMBAD: CSV over POST /sync, overflow refused by row count. See README.md#the-tap-backend.

import { parse } from 'csv-parse/sync';

export interface TapMirror {
  readonly name: string;
  readonly url: string;
}

export interface TapArchive {
  readonly mirrors: readonly [TapMirror, ...TapMirror[]];
  readonly retryDelaysMs: readonly number[];
  readonly quote: (identifier: string) => string;
}

const bare = (identifier: string): string => identifier;

export const GAIA: TapArchive = {
  mirrors: [
    { name: 'ESA-sync', url: 'https://gea.esac.esa.int/tap-server/tap' },
    { name: 'ARI-sync', url: 'https://gaia.ari.uni-heidelberg.de/tap' },
  ],
  retryDelaysMs: [2_000, 4_000, 8_000, 16_000],
  quote: bare,
};

export const VIZIER: TapArchive = {
  mirrors: [{ name: 'CDS', url: 'https://tapvizier.u-strasbg.fr/TAPVizieR/tap' }],
  retryDelaysMs: [1_000, 2_000, 4_000],
  quote: (identifier) => `"${identifier}"`,
};

export const SIMBAD: TapArchive = {
  mirrors: [
    { name: 'SIMBAD-CDS', url: 'https://simbad.cds.unistra.fr/simbad/sim-tap' },
    { name: 'SIMBAD-Harvard', url: 'https://simbad.cfa.harvard.edu/simbad/sim-tap' },
  ],
  retryDelaysMs: [1_000, 2_000, 4_000],
  quote: bare,
};

export interface HttpReply {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

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

/** `limit` rows or fewer, else `TapOverflow`: the query asks MAXREC = limit + 1, so more means truncated. */
export function readCsv(body: string, limit: number, label: string): TapResult {
  const [columns, ...cells] = parse(body, { bom: true }) as string[][];
  if (columns === undefined) throw new TapRefused(`${label}: the reply has no CSV header`);
  if (cells.length > limit) {
    throw new TapOverflow(`${label}: more than ${limit} rows; the result is truncated, so raise the limit or batch the query`);
  }
  return { columns, rows: cells.map((row) => row.map((cell) => (cell === '' ? null : cell))) };
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
  const status = queryStatus(reply.body);
  const text = reply.body.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
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

export function syncForm(adql: string, limit: number): URLSearchParams {
  return new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: String(limit + 1), QUERY: adql });
}

const isCsv = (reply: HttpReply): boolean => reply.status >= 200 && reply.status < 300 && /^text\/csv\b/i.test(reply.contentType);

export interface TapAnswer {
  readonly body: string;
  readonly result: TapResult;
}

export interface TapClientDeps {
  readonly transport: Transport;
  readonly sleep: (ms: number) => Promise<void>;
  readonly report: (service: string) => void;
  readonly log: (line: string) => void;
}

export interface TapClient {
  readonly services: readonly string[];
  /** The rows of `adql`, at most `limit` of them, from the first mirror that can hold `limit + 1` and answers. */
  query(adql: string, limit: number): Promise<TapAnswer>;
}

async function withRetry<T>(run: () => Promise<T>, delaysMs: readonly number[], sleep: (ms: number) => Promise<void>): Promise<T> {
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
    let cap = caps.get(mirror.name);
    if (cap === undefined) {
      cap = withRetry(async () => {
        const reply = await deps.transport(`${mirror.url}/capabilities`);
        if (reply.status !== 200) throw replyError(reply, `${mirror.name} /capabilities`);
        return hardRowLimit(reply.body);
      }, archive.retryDelaysMs, deps.sleep);
      cap.catch(() => caps.delete(mirror.name));
      caps.set(mirror.name, cap);
    }
    return cap;
  };

  const ask = async (mirror: TapMirror, adql: string, limit: number): Promise<TapAnswer> => {
    const reply = await deps.transport(`${mirror.url}/sync`, syncForm(adql, limit));
    if (!isCsv(reply)) throw replyError(reply, mirror.name);
    return { body: reply.body, result: readCsv(reply.body, limit, mirror.name) };
  };

  return {
    services: archive.mirrors.map((m) => m.name),
    async query(adql, limit) {
      const tooSmall: string[] = [];
      let lastTransient: unknown = null;
      for (const mirror of [...order]) {
        try {
          const cap = await capOf(mirror);
          if (cap !== null && cap < limit + 1) {
            tooSmall.push(`${mirror.name} (${cap})`);
            continue;
          }
          const answer = await withRetry(() => ask(mirror, adql, limit), archive.retryDelaysMs, deps.sleep);
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
