// Each spine row's merge decision held against what the primaries' own links derive, row by row: the divergences the switch off the spine must settle. See README.md.

import {
  linkTablesFrom, partitionRow, type KeyCell, type LinkTables,
} from '../../spine/association-audit-pure';
import type { SpineRow } from '../../spine/inherited-spine-pure';
import type { PrimaryTables, SpineKeys } from '../../spine/primaries-audit-pure';
import { normaliseGjKey } from '../../simbad/simbad-namespace-ladder-pure';

/** Why the pair rule names no owner for a HIP two Tycho-2 entries carry. */
export const PAIR_REVIEW_REASONS = ['no_hip_source', 'no_entry_matches', 'several_match'] as const;
export type PairReviewReason = (typeof PAIR_REVIEW_REASONS)[number];

/** The cells a spine row can leave empty that a primary's link fills. */
export const DERIVED_ONLY_CELLS = ['hip', 'hd', 'hr', 'gl'] as const satisfies readonly KeyCell[];
export type DerivedOnlyCell = (typeof DERIVED_ONLY_CELLS)[number];

/** Whether another spine row already carries a derived-only value. */
export const HELD_STATES = ['free', 'held'] as const;
export type HeldState = (typeof HELD_STATES)[number];

export type MergeDivergence =
  | { readonly kind: 'unlinked'; readonly cells: readonly KeyCell[]; readonly witnessed: string; readonly published: string }
  | { readonly kind: 'pair-confirmed'; readonly hip: number; readonly owner: string; readonly sourceId: string }
  | { readonly kind: 'pair-moves'; readonly hip: number; readonly owner: string; readonly sourceId: string }
  | { readonly kind: 'pair-review'; readonly hip: number; readonly entries: readonly string[]; readonly reason: PairReviewReason }
  | { readonly kind: 'derived-only'; readonly cell: DerivedOnlyCell; readonly value: string; readonly held: HeldState };

export interface MergeLinks {
  links: LinkTables;
  /** Tycho-2's own `hip` column, inverted: every entry naming the HIP. */
  hipEntries: ReadonlyMap<number, readonly string[]>;
  hdHr: ReadonlyMap<number, number>;
  /** CNS5's rows by their `hip`, as `GJ <number><comp>`. */
  cns5ByHip: ReadonlyMap<number, readonly string[]>;
  /** V/70A's rows by their `HD`, as the entry's own name. */
  v70aByHd: ReadonlyMap<number, readonly string[]>;
  held: SpineKeys;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

export function mergeLinksFrom(tables: PrimaryTables, held: SpineKeys): MergeLinks {
  const links = linkTablesFrom(tables);
  const hipEntries = new Map<number, string[]>();
  for (const [tyc, r] of tables.tycho2) if (r.hip !== null) push(hipEntries, r.hip, tyc);
  for (const entries of hipEntries.values()) entries.sort();
  const cns5ByHip = new Map<number, string[]>();
  for (const r of tables.cns5) if (r.hip !== null) push(cns5ByHip, r.hip, `GJ ${r.gj}${r.gjComp ?? ''}`);
  const v70aByHd = new Map<number, string[]>();
  for (const r of tables.gliese.byKey.values()) if (r.hd !== null) push(v70aByHd, r.hd, `${r.name}${r.comp}`);
  return {
    links,
    hipEntries,
    hdHr: hdToHr(links.hrHd),
    cns5ByHip,
    v70aByHd,
    held,
  };
}

export function hdToHr(hrHd: ReadonlyMap<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [hr, hd] of hrHd) {
    const other = out.get(hd);
    if (other !== undefined) throw new Error(`V/50 gives HD ${hd} to both HR ${other} and HR ${hr}`);
    out.set(hd, hr);
  }
  return out;
}

/** Of the Tycho-2 entries naming one HIP, the one whose Gaia best neighbour is the HIP's own. */
export function pairOwner(
  hip: number, entries: readonly string[], links: LinkTables,
): { owner: string; sourceId: string } | { reason: PairReviewReason } {
  const sourceId = links.sourceOf.hip(hip);
  if (sourceId === null) return { reason: 'no_hip_source' };
  const matches = entries.filter((tyc) => links.sourceOf.tyc(tyc) === sourceId);
  if (matches.length === 0) return { reason: 'no_entry_matches' };
  if (matches.length > 1) return { reason: 'several_match' };
  return { owner: matches[0], sourceId };
}

const intOf = (cell: string): number | null => (cell === '' ? null : Number(cell));

/** A GJ key on the bare number, whichever of V/70A's four prefixes the name carries (../../gliese-parse-pure.ts). */
function v70aNumberKey(name: string): string | null {
  return normaliseGjKey(`GJ ${name.replace(/^(Gl|GJ|NN|Wo)\s+/i, '')}`);
}

/** The pair rule's verdict on a spine row whose HIP Tycho-2 gives to two or
 *  more entries, and the HIP the row's other cells derive from. */
function pairVerdict(row: SpineRow, spineHip: number | null, m: MergeLinks): {
  divergence: MergeDivergence | null;
  hip: number | null;
} {
  const tycho2Hip = row.tyc === '' ? null : m.links.tycHip.get(row.tyc) ?? null;
  const hip = spineHip ?? tycho2Hip;
  const entries = hip === null ? [] : m.hipEntries.get(hip) ?? [];
  if (hip === null || entries.length < 2 || !entries.includes(row.tyc)) return { divergence: null, hip };
  const verdict = pairOwner(hip, entries, m.links);
  if (spineHip === null) {
    return { divergence: null, hip: 'owner' in verdict && verdict.owner === row.tyc ? hip : null };
  }
  if ('reason' in verdict) return { divergence: { kind: 'pair-review', hip, entries, reason: verdict.reason }, hip };
  return {
    divergence: verdict.owner === row.tyc
      ? { kind: 'pair-confirmed', hip, owner: verdict.owner, sourceId: verdict.sourceId }
      : { kind: 'pair-moves', hip, owner: verdict.owner, sourceId: verdict.sourceId },
    hip,
  };
}

/** Each cell the spine row leaves empty that a primary's link fills, from the row's derived HIP. */
function derivedOnlyCells(row: SpineRow, hip: number | null, m: MergeLinks): MergeDivergence[] {
  const out: MergeDivergence[] = [];
  const hd = intOf(row.hd);
  const hds = new Set<number>(row.tyc === '' ? [] : m.links.tycHd.get(row.tyc) ?? []);
  if (hip !== null) for (const d of m.links.hipHd.get(hip) ?? []) hds.add(d);
  if (hd !== null) hds.add(hd);
  const derivedOnly = (cell: DerivedOnlyCell, values: Iterable<string>, isHeld: (v: string) => boolean): void => {
    for (const value of [...new Set(values)].sort()) {
      out.push({ kind: 'derived-only', cell, value, held: isHeld(value) ? 'held' : 'free' });
    }
  };
  if (row.hip === '' && hip !== null) derivedOnly('hip', [String(hip)], (v) => m.held.hip.has(Number(v)));
  if (hd === null) derivedOnly('hd', [...hds].map(String), (v) => m.held.hd.has(Number(v)));
  if (row.hr === '') {
    const hrs = [...hds].map((d) => m.hdHr.get(d)).filter((r): r is number => r !== undefined);
    derivedOnly('hr', hrs.map(String), (v) => m.held.hr.has(Number(v)));
  }
  if (row.gl === '') {
    const gls = [
      ...(hip === null ? [] : m.cns5ByHip.get(hip) ?? []),
      ...[...hds].flatMap((d) => m.v70aByHd.get(d) ?? []),
    ];
    const byKey = new Map<string, string>();
    for (const gl of gls) {
      const key = v70aNumberKey(gl);
      if (key !== null && !byKey.has(key)) byKey.set(key, gl);
    }
    derivedOnly('gl', byKey.values(), (v) => m.held.glKeys.has(v70aNumberKey(v)!));
  }
  return out;
}

export function mergeDivergences(row: SpineRow, m: MergeLinks): MergeDivergence[] {
  const partition = partitionRow(row, m.links);
  const unlinked: MergeDivergence[] = partition !== null && partition.minority.witnessed.length > 0
    ? [{
      kind: 'unlinked',
      cells: partition.minority.witnessed,
      witnessed: partition.partition.witnessed,
      published: partition.partition.published,
    }]
    : [];
  const pair = pairVerdict(row, intOf(row.hip), m);
  return [
    ...unlinked,
    ...(pair.divergence === null ? [] : [pair.divergence]),
    ...derivedOnlyCells(row, pair.hip, m),
  ];
}
