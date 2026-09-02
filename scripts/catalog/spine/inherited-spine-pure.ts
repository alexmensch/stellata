// Column layout, codec, and count tally for data/athyg/inherited-spine.tsv.
// The contract is docs/catalog-driver.md § 3; see README.md.

import { SOL_PROPER_NAME } from '../catalog-pure';
import { starDesignations } from '../../sid/sid-pure';
import type { Star } from '../parse/stars-parse';

/** Repo-relative, so the generator and the committed-artifact guard resolve
 *  one path against REPO_ROOT rather than spelling it twice. */
export const INHERITED_SPINE_FILE = 'data/athyg/inherited-spine.tsv';
export const INHERITED_SPINE_EXPECTED_FILE =
  'scripts/catalog/spine/inherited-spine-expected.json';
export const STALE_GAIA_SOURCE_IDS_FILE = 'data/athyg/stale_gaia_source_ids.tsv';

/** Identifier fields the build resolved — the designation set
 *  `starDesignations` reads, plus the label columns the naming ladder will. */
type SpineStarFields = Pick<
  Star,
  'hip' | 'hd' | 'hr' | 'flam' | 'gl' | 'bayer' | 'proper' | 'gaiaSourceId'
>;

type ColumnSpec =
  | { readonly column: string; readonly star: keyof SpineStarFields }
  | { readonly column: string; readonly printed: true };

/** Column order of the file. `star` columns carry the build's resolved value
 *  (so the spine's designation set is the one SID allocation saw); `printed`
 *  columns are the AT-HYG cell verbatim, under its own upstream name. */
const COLUMN_SPEC = [
  { column: 'tyc', printed: true },
  { column: 'hip', star: 'hip' },
  { column: 'hd', star: 'hd' },
  { column: 'hr', star: 'hr' },
  { column: 'gl', star: 'gl' },
  { column: 'flam', star: 'flam' },
  { column: 'bayer', star: 'bayer' },
  { column: 'proper', star: 'proper' },
  { column: 'gaia_source_id', star: 'gaiaSourceId' },
  { column: 'ra', printed: true },
  { column: 'dec', printed: true },
  { column: 'dist', printed: true },
  { column: 'mag', printed: true },
  { column: 'ci', printed: true },
  { column: 'spect', printed: true },
  { column: 'rv', printed: true },
  { column: 'pm_ra', printed: true },
  { column: 'pm_dec', printed: true },
  { column: 'pos_src', printed: true },
  { column: 'dist_src', printed: true },
  { column: 'mag_src', printed: true },
  { column: 'rv_src', printed: true },
  { column: 'pm_src', printed: true },
  { column: 'spect_src', printed: true },
] as const satisfies readonly ColumnSpec[];

export type SpineColumn = (typeof COLUMN_SPEC)[number]['column'];
export type SpinePrintedColumn = Extract<
  (typeof COLUMN_SPEC)[number],
  { printed: true }
>['column'];

export const SPINE_COLUMNS: readonly SpineColumn[] = COLUMN_SPEC.map((c) => c.column);
export const SPINE_PRINTED_COLUMNS: readonly SpinePrintedColumn[] = COLUMN_SPEC
  .filter((c): c is Extract<typeof c, { printed: true }> => 'printed' in c)
  .map((c) => c.column);

/** One emitted row: every cell already in its on-disk string form. */
export type SpineRow = Record<SpineColumn, string>;
/** The AT-HYG cells a row copies verbatim, keyed by their upstream name. */
export type SpinePrintedCells = Record<SpinePrintedColumn, string>;

function starCell(value: number | string | null): string {
  return value === null ? '' : String(value);
}

export function buildSpineRow(
  star: SpineStarFields,
  printed: SpinePrintedCells,
): SpineRow {
  const row = {} as SpineRow;
  for (const spec of COLUMN_SPEC) {
    row[spec.column] = 'star' in spec
      ? starCell(star[spec.star])
      : printed[spec.column];
  }
  return row;
}

export function serializeSpine(rows: readonly SpineRow[]): string {
  const lines = [SPINE_COLUMNS.join('\t')];
  for (const row of rows) {
    const cells = SPINE_COLUMNS.map((column) => {
      const cell = row[column];
      if (/[\t\n\r]/.test(cell)) {
        throw new Error(`spine cell ${column}="${cell}" contains a TSV delimiter`);
      }
      return cell;
    });
    lines.push(cells.join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

/** Lazy row walk. `readStars` consumes this rather than `parseSpineTsv`:
 *  313,257 materialised rows hold ~660 MB for the whole walk, concurrently
 *  with the Star array being built off them. */
export function* iterSpineTsv(text: string): Generator<SpineRow> {
  const headerEnd = text.indexOf('\n');
  const header = (headerEnd === -1 ? text : text.slice(0, headerEnd)).split('\t');
  if (header.join('\t') !== SPINE_COLUMNS.join('\t')) {
    throw new Error(
      `inherited-spine header mismatch: got ${header.join(',')}`,
    );
  }
  let start = headerEnd === -1 ? text.length : headerEnd + 1;
  while (start < text.length) {
    const end = text.indexOf('\n', start);
    const line = text.slice(start, end === -1 ? text.length : end);
    start = end === -1 ? text.length : end + 1;
    if (line === '') continue;
    const cells = line.split('\t');
    if (cells.length !== SPINE_COLUMNS.length) {
      throw new Error(
        `inherited-spine row has ${cells.length} cells, expected ${SPINE_COLUMNS.length}`,
      );
    }
    const row = {} as SpineRow;
    SPINE_COLUMNS.forEach((column, i) => { row[column] = cells[i]; });
    yield row;
  }
}

export function parseSpineTsv(text: string): SpineRow[] {
  return [...iterSpineTsv(text)];
}

function intCell(cell: string): number | null {
  if (cell === '') return null;
  const n = Number.parseInt(cell, 10);
  if (!Number.isFinite(n) || String(n) !== cell) {
    throw new Error(`spine integer cell "${cell}" is not a round-trippable integer`);
  }
  return n;
}

/** The `starDesignations` set a spine row stands in for — the membership term's
 *  half of SID resolution once AT-HYG leaves the build's input set. `synth:`
 *  is absent by construction: promoted companions are not spine rows. */
export function spineDesignations(row: SpineRow): string[] {
  return starDesignations({
    isSol: row.proper === SOL_PROPER_NAME,
    hip: intCell(row.hip),
    hd: intCell(row.hd),
    hr: intCell(row.hr),
    // The spine states one value per identifier; the alias lists are the
    // overlay's addition, and the review queue is what accounts for them.
    hdAlt: [], hrAlt: [],
    gl: row.gl === '' ? null : row.gl,
    gaiaSourceId: row.gaia_source_id === '' ? null : row.gaia_source_id,
    syntheticId: null,
  });
}

export interface SpineCounts {
  rows: number;
  /** Rows carrying a value, per column — the fill rate a frozen artifact is
   *  pinned on, since it has no regeneration to diff against. */
  nonEmpty: Record<SpineColumn, number>;
}

export function spineCounts(rows: readonly SpineRow[]): SpineCounts {
  const nonEmpty = {} as Record<SpineColumn, number>;
  for (const column of SPINE_COLUMNS) nonEmpty[column] = 0;
  for (const row of rows) {
    for (const column of SPINE_COLUMNS) {
      if (row[column] !== '') nonEmpty[column]++;
    }
  }
  return { rows: rows.length, nonEmpty };
}
