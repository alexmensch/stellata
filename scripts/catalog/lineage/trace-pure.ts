// trace: a query to the origin keys it names, and every stage's rows for them in stage order. See README.md#trace.

import { isValidDesignation } from '../../sid/sid-pure';
import type { IdentityRow } from './identity-pure';
import { compareLineageRows, compareUtf8, type LineageRow } from './lineage-row-pure';

/** Gaia DR3 source_ids run to 10 digits and more; a SID never does. */
const GAIA_ID = /^[0-9]{10,}$/;
const SID = /^(?:sid:)?([0-9]{1,9})$/i;

export type TraceQuery =
  | { readonly kind: 'designation'; readonly designation: string }
  | { readonly kind: 'gaia'; readonly sourceId: string }
  | { readonly kind: 'sid'; readonly sid: number }
  | { readonly kind: 'name'; readonly name: string };

export function parseTraceQuery(text: string): TraceQuery {
  const q = text.trim();
  const gaia = /^gaia_dr3:([0-9]+)$/.exec(q)?.[1] ?? (GAIA_ID.test(q) ? q : null);
  if (gaia !== null) return { kind: 'gaia', sourceId: gaia };
  const sid = SID.exec(q);
  if (sid !== null) return { kind: 'sid', sid: Number(sid[1]) };
  if (isValidDesignation(q)) return { kind: 'designation', designation: q };
  return { kind: 'name', name: q };
}

export interface StageRows {
  readonly stage: string;
  readonly rows: readonly LineageRow[];
}

export interface TracedRecord {
  readonly key: string;
  readonly identity: IdentityRow | null;
  /** In stage order, each stage's rows in lineage order. */
  readonly rows: readonly LineageRow[];
}

/** A row names a term when its evidence cites it, or a params value holds it
 *  whole or as one `|`/`+`/`:`-separated part — a candidate list, a refusal. */
function names(row: LineageRow, terms: ReadonlySet<string>): boolean {
  if (row.evidence.some((e) => terms.has(e))) return true;
  if (![...terms].some((t) => row.params.includes(t))) return false;
  for (const value of Object.values(JSON.parse(row.params) as Record<string, string>)) {
    if (terms.has(value) || value.split(/[|+:]/).some((part) => terms.has(part))) return true;
  }
  return false;
}

export function traceRecords(
  designations: readonly string[],
  terms: readonly string[],
  identity: readonly IdentityRow[],
  stages: readonly StageRows[],
): TracedRecord[] {
  const wanted = new Set(designations);
  const termSet = new Set([...terms, ...designations]);
  const keys = new Set(identity.filter((r) => r.designations.some((d) => wanted.has(d))).map((r) => r.key));
  for (const { rows } of stages) {
    for (const row of rows) if (names(row, termSet)) keys.add(row.key);
  }
  const byKey = new Map(identity.map((r) => [r.key, r]));
  return [...keys].sort(compareUtf8).map((key) => ({
    key,
    identity: byKey.get(key) ?? null,
    rows: stages.flatMap(({ rows }) => rows.filter((r) => r.key === key).sort(compareLineageRows)),
  }));
}

export function traceText(records: readonly TracedRecord[]): string {
  if (records.length === 0) return 'no lineage row names it\n';
  const lines: string[] = [];
  for (const r of records) {
    lines.push(r.key);
    if (r.identity !== null) {
      const { tyc, hip, hd, gl, gaia_source_id: gaia } = r.identity;
      lines.push(`  identity  tyc=${tyc} hip=${hip} hd=${hd} gl=${gl} gaia=${gaia}  ${r.identity.designations.join(' ')}`);
    }
    for (const row of r.rows) {
      lines.push(`  ${row.role === 'refused' ? 'refused ' : 'outcome '} ${row.code}  ${row.params}${
        row.evidence.length > 0 ? `  evidence ${row.evidence.join(' ')}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
