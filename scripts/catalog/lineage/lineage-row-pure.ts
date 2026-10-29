// The lineage envelope every stage writes, its one sort order, and its TSV text form. See README.md#row-contract.

import { readTable, type TableSpec } from '../../util/tsv/table-pure';
import type { StageCodes } from './reason-codes-pure';

export const LINEAGE_ROLES = ['outcome', 'refused'] as const;
export type LineageRole = (typeof LINEAGE_ROLES)[number];

export const LINEAGE_COLUMNS = ['stage', 'key', 'role', 'code', 'params', 'evidence'] as const;

export type LineageParams = Readonly<Record<string, string>>;

export interface LineageRow {
  readonly stage: string;
  /** The origin SourceRowRef's text form. */
  readonly key: string;
  readonly role: LineageRole;
  readonly code: string;
  /** `paramsText` of the stage's payload. */
  readonly params: string;
  /** SourceRowRef text forms, never the origin row itself. */
  readonly evidence: readonly string[];
}

const EVIDENCE_SEPARATOR = '|';

export function paramsText(params: LineageParams): string {
  return Object.keys(params).length === 0 ? '' : JSON.stringify(params);
}

export function paramsOf(row: LineageRow): LineageParams {
  return row.params === '' ? {} : JSON.parse(row.params) as LineageParams;
}

function isSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdfff;
}

/** UTF-8 byte order, which is code-point order: a surrogate unit stands for a
 *  code point above every BMP unit, though `<` would put U+E000–U+FFFF after it. */
export function compareUtf8(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    if (isSurrogate(x) !== isSurrogate(y)) return isSurrogate(x) ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function compareLineageRows(a: LineageRow, b: LineageRow): number {
  return compareUtf8(a.key, b.key)
    || compareUtf8(a.role, b.role)
    || compareUtf8(a.code, b.code)
    || compareUtf8(a.params, b.params)
    || compareUtf8(a.evidence.join(EVIDENCE_SEPARATOR), b.evidence.join(EVIDENCE_SEPARATOR));
}

export function encodeLineageLine(row: LineageRow): string {
  const cells = [row.stage, row.key, row.role, row.code, row.params, row.evidence.join(EVIDENCE_SEPARATOR)];
  for (const cell of cells) {
    if (/[\t\n\r]/.test(cell)) throw new Error(`lineage row ${row.key}: cell "${cell}" contains a TSV delimiter`);
  }
  for (const ref of row.evidence) {
    if (ref.includes(EVIDENCE_SEPARATOR)) throw new Error(`lineage row ${row.key}: evidence "${ref}" contains "|"`);
  }
  return cells.join('\t');
}

export function assertLineageOrder(rows: readonly LineageRow[], what: string): void {
  for (let i = 1; i < rows.length; i++) {
    if (compareLineageRows(rows[i - 1], rows[i]) > 0) {
      throw new Error(`lineage: ${what} is not in lineage order at key ${rows[i].key}`);
    }
  }
}

/** `rows` arrive sorted by compareLineageRows: a stage sorts once, for its
 *  diff and its file both. */
export function stageLineageText(codes: StageCodes<string>, rows: readonly LineageRow[]): string {
  assertLineageOrder(rows, `the ${codes.stage} file`);
  for (const row of rows) {
    if (row.stage !== codes.stage) {
      throw new Error(`lineage: a row of stage ${row.stage} in the ${codes.stage} file (key ${row.key})`);
    }
    if (!codes.has(row.code)) {
      throw new Error(`lineage: ${row.code} is not a declared ${codes.stage} code (key ${row.key})`);
    }
  }
  const lines = rows.map(encodeLineageLine);
  return `${[LINEAGE_COLUMNS.join('\t'), ...lines].join('\n')}\n`;
}

function lineageSpec(file: string): TableSpec<(typeof LINEAGE_COLUMNS)[number]> {
  return { file, columns: LINEAGE_COLUMNS, hint: 'Rebuild the stage that writes it.', exact: true };
}

export function* lineageRows(text: string, file: string): Generator<LineageRow> {
  for (const row of readTable(lineageSpec(file), text)) {
    const evidence = row.raw('evidence');
    yield {
      stage: row.raw('stage'),
      key: row.raw('key'),
      role: row.oneOf('role', LINEAGE_ROLES),
      code: row.raw('code'),
      params: row.raw('params'),
      evidence: evidence === '' ? [] : evidence.split(EVIDENCE_SEPARATOR),
    };
  }
}
