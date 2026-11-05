// A pulled table's gates, each an emitArtifacts check: row band, spot rows, coverage and its floor. See README.md#gates.

import type { Check } from '../../util/emit-artifacts';
import type { Cell } from './columns-pure';

/** Inclusive both ends. */
export interface RowBand {
  readonly min: number;
  readonly max: number;
}

/** A cell's pinned value: exact text, a number within a tolerance, or `null` for an empty cell. */
export type Pinned = string | null | { readonly near: number; readonly within: number };

export interface SpotRow {
  readonly key: string;
  readonly value: string;
  readonly cells: Readonly<Record<string, Pinned>>;
}

export interface CoverageGroup {
  readonly name: string;
  readonly has: (cell: Cell) => boolean;
}

export interface Coverage {
  readonly groups: readonly [CoverageGroup, ...CoverageGroup[]];
  /** The least share of the request the union may cover. */
  readonly floor?: number;
}

const pass = (report?: string): Check => ({ kind: 'pass', report });
const fail = (message: string, report?: string): Check => ({ kind: 'fail', message, report });

export function bandCheck(label: string, rows: number, band: RowBand): Check {
  const line = `${label}: ${rows} rows, band [${band.min}, ${band.max}]`;
  return rows >= band.min && rows <= band.max
    ? pass(line)
    : fail(`${line}: outside the band — the upstream table, the request or the query moved; investigate before re-pinning`);
}

function drift(cell: Cell, cells: SpotRow['cells']): string[] {
  return Object.entries(cells).flatMap(([column, pinned]) => {
    const actual = cell(column);
    if (pinned === null) return actual === null ? [] : [`${column}: expected empty, got ${actual}`];
    if (typeof pinned === 'string') return actual === pinned ? [] : [`${column}: expected ${pinned}, got ${actual ?? 'empty'}`];
    const value = actual === null ? NaN : Number(actual);
    return Math.abs(value - pinned.near) <= pinned.within ? [] : [`${column}: expected ${pinned.near} ±${pinned.within}, got ${actual ?? 'empty'}`];
  });
}

/** Every pinned row present, every pinned cell within its pin; all drift reported at once. */
export function spotRowCheck(label: string, cells: Iterable<Cell>, spotRows: readonly SpotRow[]): Check {
  const found = new Map<SpotRow, Cell>();
  for (const cell of cells) {
    for (const spot of spotRows) {
      if (!found.has(spot) && cell(spot.key) === spot.value) found.set(spot, cell);
    }
  }
  const problems = spotRows.flatMap((spot) => {
    const cell = found.get(spot);
    const where = `${spot.key}=${spot.value}`;
    if (cell === undefined) return [`${where}: missing`];
    return drift(cell, spot.cells).map((d) => `${where} ${d}`);
  });
  return problems.length === 0
    ? pass(`${label}: ${spotRows.length} spot rows match`)
    : fail(`${label}: spot rows drifted:\n  ${problems.join('\n  ')}`);
}

/** Each group's and the union's share of `requested`; fails under the floor. */
export function coverageCheck(label: string, cells: readonly Cell[], requested: number, coverage: Coverage): Check {
  const share = (n: number): string => `${n} (${((100 * n) / requested).toFixed(1)}%)`;
  const union = cells.filter((cell) => coverage.groups.some((g) => g.has(cell))).length;
  const report = [
    `${label}: coverage of ${requested} requested`,
    `  row present ${share(cells.length)}`,
    ...coverage.groups.map((g) => `  ${g.name} ${share(cells.filter(g.has).length)}`),
    `  union ${share(union)}`,
  ].join('\n');
  const floor = coverage.floor;
  return floor === undefined || union >= floor * requested
    ? pass(report)
    : fail(`${label}: coverage ${share(union)} is under the floor ${floor}`, report);
}
