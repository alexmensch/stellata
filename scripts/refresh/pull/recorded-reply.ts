// A pull's tests replay a reply recorded from the archive, CSV lines or an ASU mirror's TSV and FITS pair, against its committed table. See README.md#files.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { ascending } from '../../../src/astro-core/order-pure';
import { cellReader, checkedRows, formatTsv, sortRows, type Column, type Row } from './columns-pure';
import { spotRowCheck } from './gates-pure';
import type { WrittenTable } from './pull';
import { cutEdges, sliceCounts, type SliceKey } from './slices-pure';
import { readCsv, tapClient, type AsuQuery, type TapArchive, type TapClientDeps } from './tap-pure';

/** A test's client deps besides its transport: no backoff, no reporting, no log. */
export const QUIET_DEPS: Omit<TapClientDeps, 'transport'> = { sleep: async () => {}, report: () => {}, log: () => {} };

export const committedText = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** A TSV's lines without its final newline; never trimEnd, which would drop a last line's trailing empty cells. */
export const tsvLines = (text: string): string[] => text.slice(0, -1).split('\n');

/** A committed table's data lines and their cells, an empty cell as `null`. */
export function committedRows(file: string): { readonly lines: readonly string[]; readonly rows: readonly Row[] } {
  const [, ...lines] = tsvLines(committedText(file));
  return { lines, rows: lines.map((line) => line.split('\t').map((cell) => (cell === '' ? null : cell))) };
}

/** The checked rows of a CSV reply's data lines under `columns`' header. */
export function replyRows(label: string, columns: readonly Column[], reply: readonly string[]): readonly Row[] {
  const csv = `${[columns.map((c) => c.name).join(','), ...reply].join('\n')}\n`;
  return checkedRows(columns, readCsv(csv, reply.length, label), label);
}

/** An ASU mirror's two replies to one query, kept beside the test as `<stem>.tsv` and `<stem>.fits`, and the query form that asked them. */
export interface RecordedAsu {
  readonly stem: string;
  readonly asu: AsuQuery;
}

const RECORDED_ROWS = 1_000;

/** The checked rows of a recorded ASU answer, read through `tapClient` as a live one is. */
export async function asuReplyRows(label: string, columns: readonly Column[], { stem, asu }: RecordedAsu): Promise<readonly Row[]> {
  const tsv = { status: 200, contentType: 'text/tab-separated-values', body: new Uint8Array(readFileSync(`${stem}.tsv`)) };
  const fits = { status: 200, contentType: 'application/fits', body: new Uint8Array(readFileSync(`${stem}.fits`)) };
  const archive: TapArchive = { mirrors: [{ name: 'recorded', protocol: 'asu', verified: true, url: 'recorded' }], format: 'fits', retryDelaysMs: [], quote: (id) => id };
  const client = tapClient(archive, {
    ...QUIET_DEPS, transport: async (url) => (url.includes('/asu-tsv?') ? tsv : fits),
  });
  return checkedRows(columns, (await client.query({ adql: label, asu }, RECORDED_ROWS)).result, label);
}

const rowsOf = (label: string, columns: readonly Column[], reply: readonly string[] | RecordedAsu): Promise<readonly Row[]> =>
  ('stem' in reply ? asuReplyRows(label, columns, reply) : Promise.resolve(replyRows(label, columns, reply)));

/** Each line `rows` would write that the committed `file` lacks, its header first when that differs. */
export function linesNotCommitted(file: string, columns: readonly Column[], rows: readonly Row[]): string[] {
  const [header, ...lines] = tsvLines(formatTsv(file, columns, rows));
  const text = committedText(file);
  const inTable = (line: string): boolean => text.startsWith(`${header}\n${line}\n`) || text.includes(`\n${line}\n`);
  return [...(text.startsWith(`${header}\n`) ? [] : [`header: ${header}`]), ...lines.filter((line) => !inTable(line))];
}

/** The counts of the committed `file`'s slices on `column` that pass `sliceRows`, and the edges a re-cut would take. */
export function oversizedSlices<T extends SliceKey>(
  file: string, column: string, edges: readonly T[], sliceRows: number, parse: (cell: string) => T,
): { readonly over: number[]; readonly recut: () => T[] } {
  const [header, ...lines] = tsvLines(committedText(file));
  const at = header.split('\t').indexOf(column);
  const keys = lines.map((line) => parse(line.split('\t')[at]));
  return {
    over: sliceCounts(keys, edges).filter((n) => n > sliceRows),
    recut: () => cutEdges(keys.sort(ascending), sliceRows),
  };
}

/** A written table's recorded reply against its committed `file`, as cases of the enclosing `describe`: its lines, its spot rows, its order. */
export function recordedTableCases(name: string, file: string, table: WrittenTable, reply: readonly string[] | RecordedAsu): void {
  const readable = lfsContentReadable(join(REPO_ROOT, file));

  it.skipIf(!readable)('writes a recorded reply\'s rows as lines of the committed table', async () => {
    expect(linesNotCommitted(file, table.columns, await rowsOf(name, table.columns, reply))).toEqual([]);
  });

  it('passes its spot rows on the recorded reply', async () => {
    const rows = await rowsOf(name, table.columns, reply);
    expect(spotRowCheck(name, rows.map(cellReader(table.columns, name)), table.spotRows).kind).toBe('pass');
  });

  it.skipIf(!readable)('orders the committed table by its sort key, as a pull writes it', () => {
    const { lines, rows } = committedRows(file);
    expect(sortRows(table.columns, rows, table.sortBy, name).map((row) => row.map((c) => c ?? '').join('\t'))).toEqual(lines);
  });
}
