// events.tsv's row shape, cell encoding, structural checks and the retired-state count. See /docs/sid.md#43-ledger--datasidledgertsv.

import type { TableRow } from '../util/tsv/table-pure';

export const SID_EVENTS = ['mint', 'retire', 'reinstate', 'merge'] as const;
export type SidEvent = (typeof SID_EVENTS)[number];

export interface EventRow {
  sid: number;
  date: string;
  event: SidEvent;
  code: string;
  /** Empty, or a JSON object: the lineage `params` text form. */
  params: string;
  /** Set on a merge only. */
  successor: number | null;
  buildVersion: string;
}

export const EVENT_COLUMNS = ['sid', 'date', 'event', 'code', 'params', 'successor', 'build_version'] as const;
type EventColumn = (typeof EVENT_COLUMNS)[number];

export function decodeEventRow(row: TableRow<EventColumn>): EventRow {
  return {
    sid: row.requiredId('sid'),
    date: row.raw('date'),
    event: row.oneOf('event', SID_EVENTS),
    code: row.raw('code'),
    params: row.raw('params'),
    successor: row.id('successor'),
    buildVersion: row.raw('build_version'),
  };
}

export function encodeEventRow(r: EventRow): Record<EventColumn, string> {
  return {
    sid: String(r.sid),
    date: r.date,
    event: r.event,
    code: r.code,
    params: r.params,
    successor: r.successor === null ? '' : String(r.successor),
    build_version: r.buildVersion,
  };
}

/** A retire or a merge takes a SID out of service; a reinstate puts it back. */
function removes(e: EventRow): boolean {
  return e.event === 'retire' || e.event === 'merge';
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** `maxSid` is the ledger's; `isCode` answers whether the generated reason-code list holds a code. */
export function validateEvents(rows: readonly EventRow[], maxSid: number, isCode: (code: string) => boolean): string[] {
  const errors: string[] = [];
  const out = new Map<number, number>();
  const mints = new Set<number>();
  for (const e of rows) {
    const at = `${e.event} of sid ${e.sid}`;
    if (e.sid < 1 || e.sid > maxSid) errors.push(`${at}: sid not in ledger`);
    if (!ISO_DATE_RE.test(e.date)) errors.push(`${at}: bad date "${e.date}"`);
    if (!VERSION_RE.test(e.buildVersion)) errors.push(`${at}: bad build version "${e.buildVersion}"`);
    if (!isCode(e.code)) errors.push(`${at}: code "${e.code}" is not in the reason-code list`);
    if (e.params !== '' && !isJsonObject(e.params)) errors.push(`${at}: params is not a JSON object`);
    if (e.event === 'merge') {
      if (e.successor === null) errors.push(`${at}: a merge names its successor`);
      else if (e.successor === e.sid) errors.push(`${at}: successor is itself`);
      else if (e.successor < 1 || e.successor > maxSid) errors.push(`${at}: successor ${e.successor} not in ledger`);
    } else if (e.successor !== null) {
      errors.push(`${at}: only a merge names a successor`);
    }
    if (e.event === 'mint') {
      if (mints.has(e.sid)) errors.push(`${at}: minted twice`);
      mints.add(e.sid);
      continue;
    }
    const n = (out.get(e.sid) ?? 0) + (removes(e) ? 1 : -1);
    if (n > 1) errors.push(`${at}: taken out of service while already out`);
    if (n < 0) errors.push(`${at}: reinstated while in service`);
    out.set(e.sid, n);
  }
  return errors;
}

function isJsonObject(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** A SID is out of service iff it has strictly more retire and merge events
 *  than reinstate events; the value is its last retire or merge. */
export function retiredSids(events: readonly EventRow[]): Map<number, EventRow> {
  const count = new Map<number, number>();
  const last = new Map<number, EventRow>();
  for (const e of events) {
    if (e.event === 'mint') continue;
    count.set(e.sid, (count.get(e.sid) ?? 0) + (removes(e) ? 1 : -1));
    if (removes(e)) last.set(e.sid, e);
  }
  const out = new Map<number, EventRow>();
  for (const [sid, n] of count) if (n > 0) out.set(sid, last.get(sid)!);
  return out;
}

/** Retired-sid → successor-sid pairs for the runtime resolver
 *  (/docs/sid.md#94-migration-semantics--exact-table), sorted by retired sid. */
export function sidSuccessorPairs(events: readonly EventRow[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (const [sid, e] of retiredSids(events)) {
    if (e.successor !== null) pairs.push([sid, e.successor]);
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}
