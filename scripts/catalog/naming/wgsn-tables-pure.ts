// The WGSN tables' row shaping and the Bayer tail unions, IV/27A then V/50. See README.md.

import { crossIndexHipsByHd, type Bsc5Row, type CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { normaliseBsc5Bayer, normaliseIv27aBayer, type NormalisedCell } from './wgsn-normalise-pure';
import type { WgsnRow } from './wgsn-parse-pure';
import { compareCodeUnits } from '../../../src/astro-core/order-pure';

export const DESIGNATION_KINDS = ['bayer', 'flamsteed', 'gould'] as const;
export const DESIGNATION_SOURCES = ['nec', 'faints', 'iv27a', 'v50'] as const;

export interface DesignationRow {
  kind: (typeof DESIGNATION_KINDS)[number];
  letter: string | null;
  sup: number | null;
  num: number | null;
  dc: string;
  half: string | null;
  component: string | null;
  hip: number | null;
  hr: number | null;
  hd: number | null;
  source: (typeof DESIGNATION_SOURCES)[number];
}


type DesignationKeys = Pick<DesignationRow, 'hip' | 'hr' | 'hd' | 'source'>;

export function designationRow(
  kind: DesignationRow['kind'],
  designation: Partial<DesignationRow>,
  keys: DesignationKeys,
): DesignationRow {
  return {
    kind,
    letter: null, sup: null, num: null, half: null, component: null,
    dc: '', ...designation, ...keys,
  };
}

export function designationFromCell(
  n: NormalisedCell,
  row: WgsnRow,
): DesignationRow | null {
  const keys: DesignationKeys = {
    hip: row.hip, hr: row.hr, hd: row.hd, source: row.source,
  };
  if (n.class === 'bayer') return designationRow('bayer', n.bayer, keys);
  if (n.class === 'flamsteed') {
    return designationRow('flamsteed', n.flamsteed, keys);
  }
  if (n.class === 'gould') {
    const { serpensHalf, ...gould } = n.gould;
    return designationRow('gould', { ...gould, half: serpensHalf }, keys);
  }
  return null;
}

type StarKeys = Pick<DesignationRow, 'hip' | 'hr' | 'hd'>;
const STAR_KEYS = ['hip', 'hr', 'hd'] as const;

/** Which stars a set of Bayer rows already reaches, by any of their keys. */
export function bayerKeySets(rows: DesignationRow[]): {
  reaches: (keys: StarKeys) => boolean;
} {
  const reached = { hip: new Set<number>(), hr: new Set<number>(), hd: new Set<number>() };
  for (const d of rows) {
    if (d.kind !== 'bayer') continue;
    for (const k of STAR_KEYS) {
      const v = d[k];
      if (v !== null) reached[k].add(v);
    }
  }
  return {
    reaches: (keys) => STAR_KEYS.some((k) => {
      const v = keys[k];
      return v !== null && reached[k].has(v);
    }),
  };
}

/** One tail source's Bayer cell, normalised. `reach` is every key set a
 *  primary links the star to, which can be wider than the keys the row ships
 *  under; the cell is covered if any of them is reached. */
export interface BayerTailCell {
  cell: NormalisedCell;
  keys: StarKeys;
  reach: readonly StarKeys[];
}

export interface BayerTail {
  added: DesignationRow[];
  cells: number;
  covered: number;
  variableRejected: number;
  unparsed: number;
}

/** A tail row is added only where no Bayer row above it reaches the star. */
export function unionBayerTail(
  above: DesignationRow[],
  cells: Iterable<BayerTailCell>,
  source: Exclude<DesignationRow['source'], 'nec' | 'faints'>,
): BayerTail {
  const reached = bayerKeySets(above);
  const tail: BayerTail = {
    added: [], cells: 0, covered: 0, variableRejected: 0, unparsed: 0,
  };
  for (const { cell, keys, reach } of cells) {
    if (cell.class === 'empty') continue;
    tail.cells++;
    if (cell.class === 'variable') { tail.variableRejected++; continue; }
    if (cell.class !== 'bayer') { tail.unparsed++; continue; }
    if (reach.some(reached.reaches)) { tail.covered++; continue; }
    tail.added.push(designationRow('bayer', { ...cell.bayer, component: null }, { ...keys, source }));
  }
  return tail;
}

export function iv27aBayerCells(crossIndex: readonly CrossIndexRow[]): BayerTailCell[] {
  return crossIndex.flatMap((row) => {
    if (row.bayer === null || row.cst === null) return [];
    const keys = { hip: row.hip, hr: null, hd: row.hd };
    return [{ cell: normaliseIv27aBayer(row.bayer, row.cst), keys, reach: [keys] }];
  });
}

/** README.md#the-union-policy: a V/50 row reaches through IV/27A's HIP. */
export function bsc5BayerCells(
  bsc5: readonly Bsc5Row[],
  crossIndex: readonly CrossIndexRow[],
): BayerTailCell[] {
  const hipsByHd = crossIndexHipsByHd(crossIndex);
  return bsc5.flatMap((row) => {
    if (row.name === null) return [];
    const keys = { hip: null, hr: row.hr, hd: row.hd };
    const linked = row.hd === null ? [] : hipsByHd.get(row.hd) ?? [];
    return [{ cell: normaliseBsc5Bayer(row.name), keys, reach: [keys, ...linked.map((hip) => ({ ...keys, hip }))] }];
  });
}

/** Every field participates: a comparator that ties leaves the committed
 *  row order to the engine's sort, and CI diffs these files byte for byte. */
function designationSortKey(d: DesignationRow): string {
  return [
    d.kind, d.dc, String(d.num ?? '').padStart(4, '0'), d.letter ?? '',
    String(d.sup ?? ''), d.half ?? '', d.component ?? '', String(d.hd ?? ''),
    String(d.hip ?? ''), String(d.hr ?? ''), d.source,
  ].join(' ');
}

export function compareDesignationRows(a: DesignationRow, b: DesignationRow): number {
  return compareCodeUnits(designationSortKey(a), designationSortKey(b));
}

export function duplicateDesignationRows(rows: readonly DesignationRow[]): number {
  return rows.length - new Set(rows.map(designationSortKey)).size;
}
