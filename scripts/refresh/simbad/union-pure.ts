// The value-keyed union: ask every namespace a row reaches wherever no object it bound carries the value. See README.md#the-union-asks-every-namespace-a-record-reaches.

import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import type { Ask } from '../pull/pull';
import { rowDesignations, type RowFilter } from './membership-keys-pure';
import { corroborate, verdictLine, type Verdicts } from './resolve-membership-pure';
import { fetchBasic, resolveOids, type BasicCells, type ParseLedger, type SimbadPhases } from './simbad-fetch-pure';
import { isFilled } from './simbad-rows-pure';
import { GAIA_DR3, WIDENING_LADDER } from './simbad-specs-pure';

/** The namespaces a union pass may ask; the order is not load-bearing, and Gaia is absent (README.md#why-the-union-asks-no-gaia-rung). */
export const UNION_NAMESPACES = WIDENING_LADDER;

interface UnansweredRow {
  /** The namespaces Phase A never bound for this row, with its key under each. */
  readonly unasked: ReadonlyMap<string, string>;
  readonly sourceId: string | null;
}

export interface UnionReport {
  rows: number;
  answered: number;
  unanswered: number;
  withUnaskedNamespace: number;
  readonly requested: Map<string, number>;
  readonly resolved: Map<string, number>;
  readonly withValue: Map<string, number>;
  readonly verdicts: Map<string, Verdicts>;
  rowsRecovered: number;
  oidsAdded: number;
}

export interface UnionResult {
  /** The basic-table cells of each object the union added. */
  readonly found: Map<number, BasicCells>;
  /** The union's own bindings, per namespace: a recovered row is reached through the key this pass asked under. */
  readonly added: Map<string, Map<string, number>>;
  readonly report: UnionReport;
}

/** Every namespace the row can be asked under, Gaia included. */
function rowKeys(record: ManifestRecord): Map<string, string> {
  const keys = new Map<string, string>(Object.entries(rowDesignations(record)).flatMap(([name, key]) => (key === undefined ? [] : [[name, key]])));
  if (record.gaiaSourceId !== null) keys.set(GAIA_DR3.name, record.gaiaSourceId);
  return keys;
}

const askable = new Set<string>(UNION_NAMESPACES.map((ns) => ns.name));

function unanswered(
  records: Iterable<ManifestRecord>, keep: RowFilter | undefined, bindings: ReadonlyMap<string, ReadonlyMap<string, number>>,
  answered: ReadonlySet<number>, report: UnionReport,
): UnansweredRow[] {
  const out: UnansweredRow[] = [];
  for (const record of records) {
    if (keep !== undefined && !keep(record)) continue;
    report.rows++;
    const keys = rowKeys(record);
    const bound = [...keys].flatMap(([name, key]) => {
      const oid = bindings.get(name)?.get(key);
      return oid === undefined ? [] : [oid];
    });
    if (bound.some((oid) => answered.has(oid))) {
      report.answered++;
      continue;
    }
    report.unanswered++;
    const unasked = new Map([...keys].filter(([name, key]) => askable.has(name) && !bindings.get(name)?.has(key)));
    if (unasked.size === 0) continue;
    report.withUnaskedNamespace++;
    out.push({ unasked, sourceId: keys.get(GAIA_DR3.name) ?? null });
  }
  return out;
}

/** {designation: the one Gaia id asking under it}; a designation two source_ids claim has none, so it stands uncorroborated rather than adjudicated against one of them. */
function askingIds(rows: readonly UnansweredRow[], name: string): Map<string, string | null> {
  const claims = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = row.unasked.get(name);
    if (key === undefined) continue;
    let claimed = claims.get(key);
    if (claimed === undefined) claims.set(key, claimed = new Set());
    if (row.sourceId !== null) claimed.add(row.sourceId);
  }
  return new Map([...claims].map(([key, ids]) => [key, ids.size === 1 ? [...ids][0] : null]));
}

/**
 * Asks every namespace an unanswered manifest row reaches and returns the objects that answer with `value` filled.
 * A namespace Phase A bound is not re-asked: it answered, with an absence. Every binding here rests on a designation
 * alone, so it is corroborated as a widening rung's is; an object whose value cell is empty is dropped.
 */
export async function unionUnanswered(
  ask: Ask, phases: SimbadPhases, ledger: ParseLedger,
  options: {
    readonly records: () => Iterable<ManifestRecord>;
    readonly keep?: RowFilter;
    readonly bindings: ReadonlyMap<string, ReadonlyMap<string, number>>;
    readonly rows: ReadonlyMap<number, BasicCells>;
    readonly value: string;
  },
): Promise<UnionResult> {
  const report: UnionReport = {
    rows: 0, answered: 0, unanswered: 0, withUnaskedNamespace: 0,
    requested: new Map(), resolved: new Map(), withValue: new Map(), verdicts: new Map(), rowsRecovered: 0, oidsAdded: 0,
  };
  const { rows, value } = options;
  const answered = new Set([...rows].filter(([, cells]) => isFilled(cells[value])).map(([oid]) => oid));
  const probed = unanswered(options.records(), options.keep, options.bindings, answered, report);
  const found = new Map<number, BasicCells>();
  const added = new Map<string, Map<string, number>>();
  if (probed.length === 0) return { found, added, report };

  const answering = new Set<number>();
  let open = probed;
  for (const ns of UNION_NAMESPACES) {
    const asked = [...new Set(open.flatMap((row) => {
      const key = row.unasked.get(ns.name);
      return key === undefined ? [] : [key];
    }))].sort();
    report.requested.set(ns.name, asked.length);
    report.resolved.set(ns.name, 0);
    report.withValue.set(ns.name, 0);
    if (asked.length === 0) continue;
    const { kept: resolved, verdicts } = await corroborate(
      ask, phases, await resolveOids(ask, phases, ns, asked, ledger), askingIds(open, ns.name), ledger,
    );
    report.resolved.set(ns.name, resolved.size);
    report.verdicts.set(ns.name, verdicts);
    const fresh = [...new Set(resolved.values())].filter((oid) => !rows.has(oid) && !found.has(oid)).sort((a, b) => a - b);
    const pulled = fresh.length > 0 ? await fetchBasic(ask, phases, fresh) : new Map<number, BasicCells>();
    const kept = [...pulled].filter(([, cells]) => isFilled(cells[value]));
    for (const [oid, cells] of kept) {
      found.set(oid, cells);
      answering.add(oid);
    }
    report.withValue.set(ns.name, kept.length);
    for (const oid of resolved.values()) if (answered.has(oid)) answering.add(oid);
    const boundNow = new Set([...resolved].filter(([, oid]) => answering.has(oid)).map(([key]) => key));
    let into = added.get(ns.name);
    if (into === undefined) added.set(ns.name, into = new Map());
    for (const key of boundNow) into.set(key, resolved.get(key) as number);
    open = open.filter((row) => {
      const key = row.unasked.get(ns.name);
      return key === undefined || !boundNow.has(key);
    });
  }
  report.oidsAdded = found.size;
  report.rowsRecovered = probed.filter((row) => [...row.unasked].some(([name, key]) => added.get(name)?.has(key))).length;
  return { found, added, report };
}

export function unionReportLines(report: UnionReport): string[] {
  const lines = [
    `      manifest rows probed: ${report.rows}; ${report.answered} answered by a bound object, ${report.unanswered} not `
    + `(${report.withUnaskedNamespace} of those carrying a namespace the request never asked)`,
  ];
  for (const [name, asked] of report.requested) {
    lines.push(`  ${name.padEnd(14)} asked ${String(asked).padStart(7)} → bound ${String(report.resolved.get(name) ?? 0).padStart(7)}, `
      + `of which ${String(report.withValue.get(name) ?? 0).padStart(7)} added a row carrying the value`);
    const verdict = report.verdicts.get(name);
    if (verdict) lines.push(`  ${''.padEnd(14)} of those bindings: ${verdictLine(verdict)}`);
  }
  lines.push(`      recovered ${report.rowsRecovered} manifest rows on ${report.oidsAdded} added objects`);
  return lines;
}

/** (manifest row, namespace, oid) for each row a union binding answers: the sample a review reads instead of a count. */
export function* recoveredRows(
  records: Iterable<ManifestRecord>, added: ReadonlyMap<string, ReadonlyMap<string, number>>, keep?: RowFilter,
): Generator<readonly [ManifestRecord, string, number]> {
  for (const record of records) {
    if (keep !== undefined && !keep(record)) continue;
    for (const [name, key] of rowKeys(record)) {
      const oid = added.get(name)?.get(key);
      if (oid !== undefined) {
        yield [record, name, oid];
        break;
      }
    }
  }
}
