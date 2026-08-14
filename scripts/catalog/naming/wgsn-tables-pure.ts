// Row shaping and the two joins behind build-wgsn-tables.ts: the IV/27A
// Bayer union, and the § 2 disposition set comparison. See README.md.

import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { normaliseIv27aBayer, type NormalisedCell } from './wgsn-normalise-pure';
import type { WgsnRow } from './wgsn-parse-pure';

export interface DesignationRow {
  kind: 'bayer' | 'flamsteed' | 'gould';
  letter: string | null;
  sup: number | null;
  num: number | null;
  dc: string;
  half: string | null;
  component: string | null;
  hip: number | null;
  hr: number | null;
  hd: number | null;
  source: 'nec' | 'faints' | 'iv27a';
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

/** Which stars the Bayer designations already reach, by either key. Built
 *  once before the IV/27A union to decide what the tail adds, and again
 *  after it to measure spine coverage. */
export function bayerKeySets(rows: DesignationRow[]): {
  reaches: (hip: number | null, hd: number | null) => boolean;
} {
  const hips = new Set<number>();
  const hds = new Set<number>();
  for (const d of rows) {
    if (d.kind !== 'bayer') continue;
    if (d.hip !== null) hips.add(d.hip);
    if (d.hd !== null) hds.add(d.hd);
  }
  return {
    reaches: (hip, hd) =>
      (hd !== null && hds.has(hd)) || (hip !== null && hips.has(hip)),
  };
}

export interface Iv27aUnion {
  added: DesignationRow[];
  cells: number;
  covered: number;
  variableRejected: number;
  unparsed: number;
}

/** WGSN is the primary designation source; IV/27A supplies only the Bayer
 *  tail, and only for stars no WGSN Bayer row already reaches. */
export function unionIv27aBayer(
  wgsnDesignations: DesignationRow[],
  crossIndex: CrossIndexRow[],
): Iv27aUnion {
  const reached = bayerKeySets(wgsnDesignations);
  const union: Iv27aUnion = {
    added: [], cells: 0, covered: 0, variableRejected: 0, unparsed: 0,
  };
  for (const row of crossIndex) {
    if (row.bayer === null || row.cst === null) continue;
    union.cells++;
    const n = normaliseIv27aBayer(row.bayer, row.cst);
    if (n.class === 'variable') { union.variableRejected++; continue; }
    if (n.class !== 'bayer') { union.unparsed++; continue; }
    if (reached.reaches(row.hip, row.hd)) { union.covered++; continue; }
    union.added.push(designationRow(
      'bayer',
      { ...n.bayer, dc: row.cst, component: null },
      { hip: row.hip, hr: null, hd: row.hd, source: 'iv27a' },
    ));
  }
  return union;
}

/** Spine propers and disposition rows meet on this key, so both sides
 *  build it here — a format that drifts turns the § 2 gate into a
 *  comparison of two disjoint sets that both look populated. */
export function spineProperKey(
  proper: string,
  hip: string,
  hd: string,
): string {
  return [proper, hip, hd].join('|');
}

export function parseDispositionKeys(tsv: string): Set<string> {
  const lines = tsv.split('\n').filter((l) => l.trim() !== '');
  const keys = new Set<string>();
  for (const line of lines.slice(1)) {
    const [proper, , hip = '', hd = ''] = line.split('\t');
    keys.add(spineProperKey(proper, hip, hd));
  }
  return keys;
}

/** The § 2 gate is exact set equality in both directions: an unmatched
 *  proper missing from the file, or a disposition the authority now covers,
 *  both fail the build. */
export function diffDispositions(
  unmatched: Set<string>,
  disposed: Set<string>,
): { missing: string[]; stale: string[] } {
  return {
    missing: [...unmatched].filter((k) => !disposed.has(k)),
    stale: [...disposed].filter((k) => !unmatched.has(k)),
  };
}

/** Every field participates: a comparator that ties leaves the committed
 *  row order to the engine's sort, and CI diffs these files byte for byte. */
export function sortDesignations(rows: DesignationRow[]): {
  sorted: DesignationRow[];
  duplicateRows: number;
} {
  const sortKey = (d: DesignationRow) => [
    d.kind, d.dc, String(d.num ?? '').padStart(4, '0'), d.letter ?? '',
    String(d.sup ?? ''), d.half ?? '', d.component ?? '', String(d.hd ?? ''),
    String(d.hip ?? ''), String(d.hr ?? ''), d.source,
  ].join(' ');
  const keyed = rows.map((d) => ({ key: sortKey(d), d }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    sorted: keyed.map((k) => k.d),
    duplicateRows: keyed.length - new Set(keyed.map((k) => k.key)).size,
  };
}
