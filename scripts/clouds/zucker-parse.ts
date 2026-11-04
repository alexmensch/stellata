// Parsers for the Zucker 2020 (/data/papers/index.md#zucker2020) and Zucker 2021 (/data/papers/index.md#zucker2021) cloud tables. See README.md.

import type { Declared } from '../util/sources/source';

export interface Sightline {
  readonly lDeg: number;
  readonly bDeg: number;
  /** 50th-percentile cloud distance. */
  readonly dPc: number;
}

/** Sightlines grouped by raw cloud name, in first-appearance order. The VizieR
 *  header, units and dashes rows carry no integer `recno` and are skipped, as is
 *  any row with an unparseable coordinate or distance. */
export function parseZ2020Sightlines(text: string): Map<string, Sightline[]> {
  const out = new Map<string, Sightline[]>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 16 || !/^\s*[+-]?\d+\s*$/.test(parts[0])) continue;
    const [lDeg, bDeg, dPc] = [parts[2], parts[3], parts[14]].map(decimal);
    if (lDeg === null || bDeg === null || dPc === null) continue;
    const name = parts[1].trim();
    out.set(name, [...(out.get(name) ?? []), { lDeg, bDeg, dPc }]);
  }
  return out;
}

function decimal(cell: string): number | null {
  const t = cell.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isNaN(v) ? null : v;
}

/** A whitespace-delimited table with one header row, read by column name. */
function readWhitespaceTable<C extends string>(
  text: string,
  columns: readonly C[],
  from: Declared,
): { cloud: string; values: Record<C, number> }[] {
  const [headerLine, ...lines] = text.split('\n');
  const header = headerLine.trim().split(/\s+/);
  const index = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${from.file}: no "${name}" column. ${from.hint}`);
    return i;
  };
  const cloudAt = index('cloud');
  const at = columns.map(index);
  return lines.map((l) => l.trim()).filter((l) => l !== '').map((l, row) => {
    const parts = l.split(/\s+/);
    const values = Object.fromEntries(columns.map((c, k) => {
      const v = decimal(parts[at[k]] ?? '');
      if (v === null) throw new Error(`${from.file}: row ${row + 2} has no number in "${c}". ${from.hint}`);
      return [c, v];
    })) as Record<C, number>;
    return { cloud: parts[cloudAt], values };
  });
}

export interface Z2021Extent {
  readonly cloud: string;
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
  readonly zmin: number;
  readonly zmax: number;
}

/** Table 1: the galactic-Cartesian bounding box of each cloud's spine skeleton, pc. */
export function parseZ2021Extents(text: string, from: Declared): Z2021Extent[] {
  return readWhitespaceTable(text, ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'] as const, from)
    .map(({ cloud, values }) => ({ cloud, ...values }));
}

export interface PlummerFit {
  readonly n0: number;
  readonly rflat: number;
  readonly p: number;
}

/** Table 2's Plummer columns, by raw cloud name. */
export function parseZ2021PlummerFits(text: string, from: Declared): Map<string, PlummerFit> {
  return new Map(readWhitespaceTable(text, ['n0', 'rflat', 'p'] as const, from)
    .map(({ cloud, values }) => [cloud, values]));
}

export interface Z2021Mass {
  readonly massNicest: number;
  readonly massLeike: number;
  readonly maxAkLeike: number;
}

/** Table 3's masses and Leike 2020 (/data/papers/index.md#leike2020)-resolution peak A_K, by raw cloud name. */
export function parseZ2021Masses(text: string, from: Declared): Map<string, Z2021Mass> {
  return new Map(readWhitespaceTable(text, ['mass_nicest', 'mass_leike', 'max_ak_leike'] as const, from)
    .map(({ cloud, values }) => [cloud, {
      massNicest: values.mass_nicest,
      massLeike: values.mass_leike,
      maxAkLeike: values.max_ak_leike,
    }]));
}
