// Which of a spine row's identifiers the primaries' own cross-references link
// to one another, and which only AT-HYG associates. See README.md#the-association-audit.

import { lookupGliese } from '../gliese-parse';
import { normaliseGjKey } from '../record/catalog-pure';
import type { SpineRow } from './inherited-spine-pure';
import {
  bareGjKey, cns5RowFor, indexCns5, type PrimaryTables, type SimbadXids,
} from './primaries-audit-pure';

export type KeyCell = 'tyc' | 'hip' | 'hd' | 'hr' | 'gl';
export const KEY_CELLS: readonly KeyCell[] = ['tyc', 'hip', 'hd', 'hr', 'gl'];

/** The primaries' own cross-references, keyed by the cell each one indexes. */
export interface LinkTables {
  /** IV/25 — TYC → the HD numbers it carries. */
  tycHd: ReadonlyMap<string, ReadonlySet<number>>;
  /** Tycho-2's own `hip` column. */
  tycHip: ReadonlyMap<string, number>;
  /** I/239's `HD` column and IV/27A's `hip` column — HIP → HD numbers. */
  hipHd: ReadonlyMap<number, ReadonlySet<number>>;
  /** V/50 — HR → HD. */
  hrHd: ReadonlyMap<number, number>;
  /** CNS5's `hip`, for the record's own `gl` cell. */
  glHip: (gl: string) => number | null;
  /** V/70A's `HD` column, for the record's own `gl` cell. */
  glHd: (gl: string) => number | null;
  /** The Gaia source each cell's best-neighbour walk (CNS5's own row for `gl`) names. */
  sourceOf: {
    tyc: (tyc: string) => string | null;
    hip: (hip: number) => string | null;
    gl: (gl: string) => string | null;
  };
  /** SIMBAD's frozen cross-IDs under a Gaia source. */
  simbad: (sourceId: string) => SimbadXids | undefined;
}

/** `published` is the primaries' own columns; `witnessed` adds the Gaia
 *  best-neighbour consensus and SIMBAD's cross-IDs. */
export type LinkClass = 'published' | 'witnessed';
export const LINK_CLASSES: readonly LinkClass[] = ['published', 'witnessed'];

export interface RowPartition {
  /** Cells the row carries a value in, file order. */
  cells: KeyCell[];
  /** Per class, the connected components, each `cell+cell`, joined ` | `. */
  partition: Record<LinkClass, string>;
  /** Per class, cells outside the largest component. Which component is
   *  "largest" breaks ties alphabetically, so on an even split (`gl | hip`)
   *  this names one side arbitrarily: count rows by `partition`, not cells
   *  by this. */
  minority: Record<LinkClass, KeyCell[]>;
}

class UnionFind {
  private readonly parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

function components(uf: UnionFind, cells: readonly KeyCell[]): KeyCell[][] {
  const byRoot = new Map<number, KeyCell[]>();
  cells.forEach((cell, i) => {
    const root = uf.find(i);
    const group = byRoot.get(root) ?? [];
    group.push(cell);
    byRoot.set(root, group);
  });
  return [...byRoot.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function bareGl(cell: string | null): string | null {
  const key = normaliseGjKey(cell);
  return key === null ? null : bareGjKey(key);
}

export function partitionRow(row: SpineRow, links: LinkTables): RowPartition | null {
  const cells = KEY_CELLS.filter((c) => row[c] !== '');
  if (cells.length < 2) return null;
  const at = new Map(cells.map((c, i) => [c, i] as const));
  const hip = row.hip === '' ? null : Number(row.hip);
  const hd = row.hd === '' ? null : Number(row.hd);
  const hr = row.hr === '' ? null : Number(row.hr);
  const has = (c: KeyCell): boolean => at.has(c);

  const published = (uf: UnionFind): void => {
    const link = (a: KeyCell, b: KeyCell): void => uf.union(at.get(a)!, at.get(b)!);
    if (has('tyc') && has('hd') && links.tycHd.get(row.tyc)?.has(hd!)) link('tyc', 'hd');
    if (has('tyc') && has('hip') && links.tycHip.get(row.tyc) === hip) link('tyc', 'hip');
    if (has('hip') && has('hd') && links.hipHd.get(hip!)?.has(hd!)) link('hip', 'hd');
    if (has('hr') && has('hd') && links.hrHd.get(hr!) === hd) link('hr', 'hd');
    if (has('gl') && has('hip') && links.glHip(row.gl) === hip) link('gl', 'hip');
    if (has('gl') && has('hd') && links.glHd(row.gl) === hd) link('gl', 'hd');
  };
  const witnessed = (uf: UnionFind): void => {
    const link = (a: KeyCell, b: KeyCell): void => uf.union(at.get(a)!, at.get(b)!);
    const sources: Array<[KeyCell, string | null]> = [
      ['tyc', has('tyc') ? links.sourceOf.tyc(row.tyc) : null],
      ['hip', has('hip') ? links.sourceOf.hip(hip!) : null],
      ['gl', has('gl') ? links.sourceOf.gl(row.gl) : null],
    ];
    for (let i = 0; i < sources.length; i++) {
      for (let k = i + 1; k < sources.length; k++) {
        const [a, sa] = sources[i];
        const [b, sb] = sources[k];
        if (sa !== null && sa === sb) link(a, b);
      }
    }
    const glKey = has('gl') ? bareGl(row.gl) : null;
    for (const [cell, source] of sources) {
      if (source === null) continue;
      const xids = links.simbad(source);
      if (xids === undefined) continue;
      if (has('tyc') && cell !== 'tyc' && xids.tyc === row.tyc) link(cell, 'tyc');
      if (has('hip') && cell !== 'hip' && xids.hip === hip) link(cell, 'hip');
      if (glKey !== null && cell !== 'gl' && bareGl(xids.gj) === glKey) link(cell, 'gl');
    }
  };

  const ufPublished = new UnionFind(cells.length);
  published(ufPublished);
  const ufWitnessed = new UnionFind(cells.length);
  published(ufWitnessed);
  witnessed(ufWitnessed);
  const describe = (uf: UnionFind): { partition: string; minority: KeyCell[] } => {
    const groups = components(uf, cells);
    return {
      partition: groups.map((g) => g.join('+')).join(' | '),
      minority: groups.slice(1).flat(),
    };
  };
  const p = describe(ufPublished);
  const w = describe(ufWitnessed);
  return {
    cells,
    partition: { published: p.partition, witnessed: w.partition },
    minority: { published: p.minority, witnessed: w.minority },
  };
}

export interface AssociationSummary {
  rows: number;
  /** Rows carrying two or more of the key cells — the only ones with an association to check. */
  multiRows: number;
  disconnected: Record<LinkClass, number>;
  minorityCells: Record<LinkClass, Partial<Record<KeyCell, number>>>;
  patterns: Record<LinkClass, Record<string, number>>;
}

export interface DisconnectedRow {
  row: SpineRow;
  partition: RowPartition;
}

export interface AssociationAudit {
  summary: AssociationSummary;
  /** Rows disconnected under the `witnessed` class — the associations only AT-HYG makes. */
  disconnected: DisconnectedRow[];
}

export function auditAssociations(
  spine: readonly SpineRow[], links: LinkTables,
): AssociationAudit {
  const summary: AssociationSummary = {
    rows: spine.length,
    multiRows: 0,
    disconnected: { published: 0, witnessed: 0 },
    minorityCells: { published: {}, witnessed: {} },
    patterns: { published: {}, witnessed: {} },
  };
  const disconnected: DisconnectedRow[] = [];
  for (const row of spine) {
    const partition = partitionRow(row, links);
    if (partition === null) continue;
    summary.multiRows++;
    for (const cls of LINK_CLASSES) {
      if (partition.minority[cls].length === 0) continue;
      summary.disconnected[cls]++;
      const pattern = partition.partition[cls];
      summary.patterns[cls][pattern] = (summary.patterns[cls][pattern] ?? 0) + 1;
      for (const cell of partition.minority[cls]) {
        summary.minorityCells[cls][cell] = (summary.minorityCells[cls][cell] ?? 0) + 1;
      }
    }
    if (partition.minority.witnessed.length > 0) disconnected.push({ row, partition });
  }
  return { summary, disconnected };
}

export function formatAssociationReport(s: AssociationSummary): string {
  const lines = [`spine rows: ${s.rows}; carrying 2+ of ${KEY_CELLS.join('/')}: ${s.multiRows}`];
  for (const cls of LINK_CLASSES) {
    lines.push(`disconnected under ${cls} links: ${s.disconnected[cls]}`);
    lines.push(`  cells in a minority component: ${
      Object.entries(s.minorityCells[cls]).map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}`);
    for (const [pattern, n] of Object.entries(s.patterns[cls]).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${String(n).padStart(6)}  ${pattern}`);
    }
  }
  return lines.join('\n');
}

export function linkTablesFrom(tables: PrimaryTables): LinkTables {
  const tycHd = new Map<string, Set<number>>();
  for (const r of tables.iv25) {
    const set = tycHd.get(r.tyc) ?? new Set<number>();
    set.add(r.hd);
    tycHd.set(r.tyc, set);
  }
  const tycHip = new Map<string, number>();
  for (const [tyc, r] of tables.tycho2) if (r.hip !== null) tycHip.set(tyc, r.hip);
  const hipHd = new Map<number, Set<number>>();
  const addHipHd = (hip: number, hd: number): void => {
    const set = hipHd.get(hip) ?? new Set<number>();
    set.add(hd);
    hipHd.set(hip, set);
  };
  for (const [hip, hd] of tables.i239HipHd) addHipHd(hip, hd);
  for (const r of tables.iv27a) if (r.hip !== null) addHipHd(r.hip, r.hd);
  const hrHd = new Map<number, number>();
  for (const r of tables.v50) if (r.hd !== null) hrHd.set(r.hr, r.hd);
  const { cns5ByKey } = indexCns5(tables.cns5);
  const cns5For = (gl: string) => cns5RowFor(gl, cns5ByKey, tables.glAliases);
  return {
    tycHd,
    tycHip,
    hipHd,
    hrHd,
    glHip: (gl) => cns5For(gl)?.hip ?? null,
    glHd: (gl) => lookupGliese(tables.gliese, gl)?.hd ?? null,
    sourceOf: {
      tyc: (tyc) => tables.tycToSource.get(tyc) ?? null,
      hip: (hip) => tables.hipToSource.get(hip) ?? null,
      gl: (gl) => cns5For(gl)?.gaiaSourceId ?? null,
    },
    simbad: (sourceId) => tables.simbadBySourceId.get(sourceId),
  };
}
