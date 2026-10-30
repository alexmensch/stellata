// The lineage envelope every stage writes, its TSV line, and the one sort order over lines. See README.md#row-contract.

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

declare const LINEAGE_LINE: unique symbol;

/** A row as its TSV line, made only by stageLineageLine or read from a stage file. */
export type LineageLine = string & { readonly [LINEAGE_LINE]: true };

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

/** See README.md#sourcerowref for why the control characters below tab are refused. */
export function encodeLineageLine(row: LineageRow): string {
  const cells = [row.stage, row.key, row.role, row.code, row.params, row.evidence.join(EVIDENCE_SEPARATOR)];
  for (const cell of cells) {
    if (/[\x00-\x08\t\n\r]/.test(cell)) {
      throw new Error(`lineage row ${row.key}: cell "${cell}" contains a TSV delimiter or a control character below tab`);
    }
  }
  for (const ref of row.evidence) {
    if (ref.includes(EVIDENCE_SEPARATOR)) throw new Error(`lineage row ${row.key}: evidence "${ref}" contains "|"`);
  }
  return cells.join('\t');
}

/** The row's line, refused when the stage does not write it or does not declare its code. */
export function stageLineageLine(codes: StageCodes<string>, row: LineageRow): LineageLine {
  if (row.stage !== codes.stage) {
    throw new Error(`lineage: a row of stage ${row.stage} in the ${codes.stage} file (key ${row.key})`);
  }
  if (!codes.has(row.code)) {
    throw new Error(`lineage: ${row.code} is not a declared ${codes.stage} code (key ${row.key})`);
  }
  return encodeLineageLine(row) as LineageLine;
}

export function sortLineageLines(lines: readonly LineageLine[]): LineageLine[] {
  return [...lines].sort(compareUtf8);
}

export const ENCODE_BATCH = 100_000;

/** See README.md#storage-and-cost. */
export function utf8Lines(header: string, lines: Iterable<string>, batch = ENCODE_BATCH): Uint8Array {
  const parts: Buffer[] = [Buffer.from(`${header}\n`)];
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) parts.push(Buffer.from(`${pending.join('\n')}\n`));
    pending = [];
  };
  for (const line of lines) {
    pending.push(line);
    if (pending.length === batch) flush();
  }
  flush();
  return Buffer.concat(parts);
}

/** `lines` arrive sorted: a stage sorts once, for its diff and its file both. */
export function stageLineageText(codes: StageCodes<string>, lines: readonly LineageLine[]): Uint8Array {
  const prefix = `${codes.stage}\t`;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) {
      throw new Error(`lineage: a line of another stage in the ${codes.stage} file (key ${lineageLineKey(lines[i])})`);
    }
    if (i > 0 && compareUtf8(lines[i - 1], lines[i]) > 0) {
      throw new Error(`lineage: the ${codes.stage} file is not in lineage order at key ${lineageLineKey(lines[i])}`);
    }
  }
  return utf8Lines(LINEAGE_COLUMNS.join('\t'), lines);
}

function lineCell(line: LineageLine, column: (typeof LINEAGE_COLUMNS)[number]): string {
  let start = 0;
  for (let i = LINEAGE_COLUMNS.indexOf(column); i > 0; i--) start = line.indexOf('\t', start) + 1;
  const end = line.indexOf('\t', start);
  return line.slice(start, end === -1 ? line.length : end);
}

export function lineageLineKey(line: LineageLine): string {
  return lineCell(line, 'key');
}

export function lineageLineCode(line: LineageLine): string {
  return lineCell(line, 'code');
}

function rowOfCells(cells: readonly string[], where: string): LineageRow {
  const [stage, key, role, code, params, evidence] = cells;
  if (!(LINEAGE_ROLES as readonly string[]).includes(role)) {
    throw new Error(`${where}: role "${role}" is not one of ${LINEAGE_ROLES.join(', ')}`);
  }
  return {
    stage, key, role: role as LineageRole, code, params,
    evidence: evidence === '' ? [] : evidence.split(EVIDENCE_SEPARATOR),
  };
}

export function decodeLineageLine(line: LineageLine): LineageRow {
  return rowOfCells(line.split('\t'), `lineage line ${lineageLineKey(line)}`);
}

function lineageSpec(file: string): TableSpec<(typeof LINEAGE_COLUMNS)[number]> {
  return { file, columns: LINEAGE_COLUMNS, hint: 'Rebuild the stage that writes it.', exact: true };
}

export function* lineageLines(text: string | Uint8Array, file: string): Generator<LineageLine> {
  for (const row of readTable(lineageSpec(file), text)) yield row.rawLine as LineageLine;
}

export function* lineageRows(text: string | Uint8Array, file: string): Generator<LineageRow> {
  for (const row of readTable(lineageSpec(file), text)) {
    yield rowOfCells(LINEAGE_COLUMNS.map((c) => row.raw(c)), `${file}:${row.line}`);
  }
}
