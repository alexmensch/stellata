// A SIMBAD pull's written rows: basic columns, then per-oid blocks, each bibcoded group shipped only beside its bibcode; and its fill gates. See README.md.

import type { Check } from '../../util/emit-artifacts';
import type { Column, Row } from '../pull/columns-pure';
import type { BasicCells } from './simbad-fetch-pure';
import { OID, fluxColumns, type BasicColumn, type BibcodedGroup, type FluxBand, type Namespace } from './simbad-specs-pure';

/** Neither null nor blank: SIMBAD answers both for an absent value, depending on the column's type. */
export const isFilled = (cell: string | null | undefined): boolean => cell !== null && cell !== undefined && cell.trim() !== '';

/** TSV columns appended after the basic ones, each oid's cells looked up by name. */
export interface Block {
  readonly names: readonly string[];
  readonly cell: (oid: number, name: string) => string | null;
}

export const identNames = (namespaces: readonly Namespace[]): string[] => namespaces.map((ns) => ns.name);
export const fluxNames = (bands: readonly FluxBand[]): string[] => bands.flatMap((b) => fluxColumns(b).map((c) => c.tsv));

export function identBlock(namespaces: readonly Namespace[], idents: ReadonlyMap<number, ReadonlyMap<string, string>>): Block {
  return { names: identNames(namespaces), cell: (oid, name) => idents.get(oid)?.get(name) ?? null };
}

export function fluxBlock(bands: readonly FluxBand[], flux: ReadonlyMap<number, Readonly<Record<string, string | null>>>): Block {
  return { names: fluxNames(bands), cell: (oid, name) => flux.get(oid)?.[name] ?? null };
}

export function simbadColumns(basic: readonly [typeof OID, ...BasicColumn[]], blockNames: readonly (readonly string[])[]): [Column, ...Column[]] {
  const [first, ...rest] = basic;
  return [{ name: first.tsv }, ...rest.map((c) => ({ name: c.tsv })), ...blockNames.flat().map((name) => ({ name }))];
}

/** One row per oid; an oid with no basic row still carries its key, and a group whose bibcode is empty takes its values down with it. */
export function simbadRows(
  oids: Iterable<number>, basicRows: ReadonlyMap<number, BasicCells>, basic: readonly [typeof OID, ...BasicColumn[]],
  blocks: readonly Block[], groups: readonly BibcodedGroup[] = [],
): Row[] {
  const names = simbadColumns(basic, blocks.map((b) => b.names)).map((c) => c.name);
  const at = new Map(names.map((name, i) => [name, i]));
  const index = (name: string): number => {
    const i = at.get(name);
    if (i === undefined) throw new Error(`bibcoded group names ${name}, which the table does not write`);
    return i;
  };
  const dropped = groups.map((g) => ({ bibcode: index(g.bibcode), values: g.values.map(index) }));
  return [...oids].map((oid) => {
    const cells = basicRows.get(oid);
    const row: (string | null)[] = [
      String(oid),
      ...basic.slice(1).map((c) => cells?.[c.column] ?? null),
      ...blocks.flatMap((b) => b.names.map((name) => b.cell(oid, name))),
    ];
    for (const g of dropped) if (!isFilled(row[g.bibcode])) for (const i of g.values) row[i] = null;
    return row;
  });
}

export const countFilled = <T>(rows: Iterable<T>, filled: (row: T) => boolean): number => {
  let n = 0;
  for (const row of rows) if (filled(row)) n++;
  return n;
};

export const fillLine = (label: string, filled: number, total: number): string =>
  `  ${label.padEnd(16)} ${String(filled).padStart(6)}/${total} = ${((100 * filled) / Math.max(1, total)).toFixed(1)}%`;

/** A fill below its floor means the response shape or the request drifted, not a sparse cohort. */
export function floorCheck(label: string, fraction: number, floor: number, diagnosis: string): Check {
  const line = `${label} ${(100 * fraction).toFixed(1)}%, floor ${(100 * floor).toFixed(0)}%`;
  return fraction >= floor ? { kind: 'pass', report: line } : { kind: 'fail', message: `${line}: ${diagnosis}; investigate before pinning` };
}
