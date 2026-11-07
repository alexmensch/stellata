// The lineage envelope every stage writes, its TSV line, and the one sort order over lines. See README.md#row-contract.

import { fold } from '../../util/counts/tally-pure';
import { readTable, readTableLines, type TableSpec } from '../../util/tsv/table-pure';
import type { StageCode, StageCodes } from './reason-codes-pure';

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
  return parseParams(row.params);
}

export function parseParams(text: string): LineageParams {
  return text === '' ? {} : JSON.parse(text) as LineageParams;
}

function isSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdfff;
}

/** Below U+D800 a UTF-16 unit is its own code point, so the engine's native unit order is UTF-8 order. */
const UNIT_ORDER_MAY_DIFFER = /[\uD800-\uFFFF]/;

function nativeOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** UTF-8 byte order, which is code-point order: a surrogate unit stands for a
 *  code point above every BMP unit, though `<` would put U+E000–U+FFFF after it. */
export function compareUtf8(a: string, b: string): number {
  if (!UNIT_ORDER_MAY_DIFFER.test(a) && !UNIT_ORDER_MAY_DIFFER.test(b)) return nativeOrder(a, b);
  return compareCodePoints(a, b);
}

/** `items` sorted in place by `keyOf` in UTF-8 byte order; the native order whenever no key needs the slow one. */
export function sortUtf8<T>(items: T[], keyOf: (item: T) => string): T[] {
  if (items.every((item) => !UNIT_ORDER_MAY_DIFFER.test(keyOf(item)))) {
    return items.sort((x, y) => nativeOrder(keyOf(x), keyOf(y)));
  }
  return items.sort((x, y) => compareCodePoints(keyOf(x), keyOf(y)));
}

function compareCodePoints(a: string, b: string): number {
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
  return sortUtf8([...lines], (line) => line);
}

export const ENCODE_BATCH = 100_000;

export function utf8Batch(lines: readonly string[]): Buffer {
  return Buffer.from(`${lines.join('\n')}\n`);
}

/** See README.md#storage-and-cost. */
export function utf8Lines(header: string, lines: Iterable<string>, batch = ENCODE_BATCH): Uint8Array {
  const parts: Buffer[] = [utf8Batch([header])];
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) parts.push(utf8Batch(pending));
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

export function lineageLineParams(line: LineageLine): string {
  return lineCell(line, 'params');
}

/** How many of a stage's lines in `role` carry each of its codes, every code present; a line of another stage throws. */
export function foldStageLines<B extends string, S extends string>(
  codes: StageCodes<B, S>, lines: Iterable<LineageLine>, role: LineageRole,
): Record<StageCode<S, B>, number> {
  function* inRole(): Generator<LineageLine> {
    for (const line of lines) if (lineCell(line, 'role') === role) yield line;
  }
  return fold(codes.codes, inRole(), lineageLineCode);
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
  for (const line of readTableLines(lineageSpec(file), text)) yield line as LineageLine;
}

export function* lineageRows(text: string | Uint8Array, file: string): Generator<LineageRow> {
  for (const row of readTable(lineageSpec(file), text)) {
    yield rowOfCells(LINEAGE_COLUMNS.map((c) => row.raw(c)), `${file}:${row.line}`);
  }
}
