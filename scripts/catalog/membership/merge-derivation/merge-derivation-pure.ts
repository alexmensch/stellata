// Each spine row's merge decision held against what the primaries' own links derive, row by row: the divergences the switch off the spine must settle. See README.md.

import {
  linkTablesFrom, partitionRow, type KeyCell, type LinkTables,
} from '../../spine/association-audit-pure';
import type { SpineRow } from '../../spine/inherited-spine-pure';
import type { PrimaryTables, SpineKeys } from '../../spine/primaries-audit-pure';
import { normaliseGjKey } from '../../simbad/simbad-namespace-ladder-pure';
import type { GlieseRow } from '../../gliese-parse-pure';
import { formatGlieseDisplay } from '../../classic-ids/label-merge/label-merge-pure';
import { cns5Gl } from '../additions/addition-items-pure';
import { hdNumbers, type SimbadTycHdRow } from '../../simbad/simbad-tyc-hd-parse';
import type { PairReviewReason } from '../ledger-rows-pure';


/** The cells a spine row can leave empty that a primary's link fills. */
export const DERIVED_ONLY_CELLS = ['hip', 'hd', 'hr', 'gl'] as const satisfies readonly KeyCell[];
export type DerivedOnlyCell = (typeof DERIVED_ONLY_CELLS)[number];

/** Whether another spine row already carries a derived-only value. */
export const HELD_STATES = ['free', 'held'] as const;
export type HeldState = (typeof HELD_STATES)[number];

/** A primary's link from one cell of the row to another: `to` is the cell
 *  it fills, `from` the cell it reads. */
export const DIFFERS_LINKS = [
  { to: 'hip', from: 'tyc', key: 'hip<tyc' },
  { to: 'hd', from: 'tyc', key: 'hd<tyc' },
  { to: 'hd', from: 'hip', key: 'hd<hip' },
  { to: 'hr', from: 'hd', key: 'hr<hd' },
  { to: 'gl', from: 'hip', key: 'gl<hip' },
  { to: 'gl', from: 'hd', key: 'gl<hd' },
] as const satisfies readonly { to: KeyCell; from: KeyCell; key: string }[];
export type DiffersLink = (typeof DIFFERS_LINKS)[number];

export type MergeDivergence =
  | { readonly kind: 'unlinked'; readonly cells: readonly KeyCell[]; readonly witnessed: string; readonly published: string }
  | { readonly kind: 'pair-confirmed'; readonly hip: number; readonly owner: string; readonly sourceId: string }
  | {
    readonly kind: 'pair-moves';
    readonly hip: number;
    readonly owner: string;
    readonly sourceId: string;
    /** `record` when the owner entry is another spine record's, which takes the HIP. */
    readonly onto: PairMoveTarget;
  }
  | { readonly kind: 'pair-review'; readonly hip: number; readonly entries: readonly string[]; readonly reason: PairReviewReason }
  | { readonly kind: 'derived-only'; readonly cell: DerivedOnlyCell; readonly value: string; readonly held: HeldState }
  | { readonly kind: 'differs'; readonly link: DiffersLink; readonly spine: string; readonly derived: readonly string[] };

export const PAIR_MOVE_TARGETS = ['entry', 'record'] as const;
export type PairMoveTarget = (typeof PAIR_MOVE_TARGETS)[number];
/** What `applyPairRule` decided on a row the Gaia test alone would move. */
export type PairDecision = Extract<MergeDivergence, { kind: 'pair-moves' | 'pair-review' }>;

export interface PairLinks {
  links: LinkTables;
  /** Tycho-2's own `hip` column, inverted: every entry naming the HIP. */
  hipEntries: ReadonlyMap<number, readonly string[]>;
  hdHr: ReadonlyMap<number, number>;
  /** CNS5's rows by their `hip`, in the record's GJ form. */
  cns5ByHip: ReadonlyMap<number, readonly string[]>;
  /** V/70A's rows by their `HD`, in the record's GJ form. */
  v70aByHd: ReadonlyMap<number, readonly string[]>;
}

export interface MergeLinks extends PairLinks {
  held: SpineKeys;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

export function pairLinksFrom(tables: PrimaryTables): PairLinks {
  const links = linkTablesFrom(tables);
  const hipEntries = new Map<number, string[]>();
  for (const [tyc, r] of tables.tycho2) if (r.hip !== null) push(hipEntries, r.hip, tyc);
  for (const entries of hipEntries.values()) entries.sort();
  const cns5ByHip = new Map<number, string[]>();
  for (const r of tables.cns5) if (r.hip !== null) push(cns5ByHip, r.hip, cns5Gl(r)!);
  const v70aByHd = new Map<number, string[]>();
  for (const r of tables.gliese.byKey.values()) if (r.hd !== null) push(v70aByHd, r.hd, v70aGl(r));
  return {
    links,
    hipEntries,
    hdHr: hdToHr(links.hrHd),
    cns5ByHip,
    v70aByHd,
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

/** A V/70A entry in the record's GJ form, whichever of the catalogue's four prefixes it prints (../../gliese-parse-pure.ts). */
function v70aGl(row: GlieseRow): string {
  return formatGlieseDisplay(`${row.name.replace(/^(Gl|GJ|NN|Wo)\s+/i, '')}${row.comp}`.replace(/\s+/g, ''));
}

/** The pair rule's verdict on a spine row whose HIP Tycho-2 gives to two or
 *  more entries, and the HIP the row's other cells derive from. */
function pairVerdict(row: SpineRow, spineHip: number | null, m: PairLinks): {
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
      : { kind: 'pair-moves', hip, owner: verdict.owner, sourceId: verdict.sourceId, onto: 'entry' },
    hip,
  };
}

type PairMove = Extract<MergeDivergence, { kind: 'pair-moves' }>;
type PairRuleResult = {
  rows: SpineRow[];
  decided: ReadonlyMap<number, PairDecision>;
  /** Rows a HIP moved onto from another spine record. */
  received: ReadonlySet<number>;
};

/** Every move the Gaia test makes, each applied unless `refusal` names why it is queued instead. */
function applyMoves(
  kept: readonly SpineRow[], m: PairLinks, refusal: (move: PairMove, receiver: SpineRow) => PairReviewReason | null,
): PairRuleResult {
  const rows = [...kept];
  const byTyc = new Map<string, number>();
  kept.forEach((r, i) => { if (r.tyc !== '') byTyc.set(r.tyc, i); });
  const decided = new Map<number, PairDecision>();
  const received = new Set<number>();
  const owners = new Set<string>();
  kept.forEach((row, i) => {
    const move = pairVerdict(row, intOf(row.hip), m).divergence;
    if (move?.kind !== 'pair-moves') return;
    const j = byTyc.get(move.owner);
    if (j !== undefined && kept[j].hip !== '') {
      throw new Error(`pair rule: HIP ${move.hip} moves onto ${move.owner}, whose spine record carries HIP ${kept[j].hip}`);
    }
    const receiver = j === undefined ? { ...row, tyc: move.owner } : { ...kept[j], hip: String(move.hip) };
    const reason = refusal(move, receiver);
    if (reason !== null) {
      decided.set(i, { kind: 'pair-review', hip: move.hip, entries: m.hipEntries.get(move.hip)!, reason });
      return;
    }
    if (owners.has(move.owner)) throw new Error(`pair rule: two HIPs move onto Tycho-2 entry ${move.owner}`);
    owners.add(move.owner);
    if (j === undefined) {
      rows[i] = receiver;
      decided.set(i, move);
      return;
    }
    rows[i] = { ...rows[i], hip: '' };
    rows[j] = receiver;
    received.add(j);
    decided.set(i, { ...move, onto: 'record' });
  });
  return { rows, decided, received };
}

/** see README.md#applying-the-pair-rule */
export function applyPairRule(
  kept: readonly SpineRow[], m: PairLinks, binds: (row: SpineRow) => string | null, refused: ReadonlySet<number>,
): PairRuleResult {
  return applyMoves(kept, m, (move, receiver) => {
    if (binds(receiver) !== move.sourceId) return 'gate_refused';
    return refused.has(move.hip) ? 'simbad_refused' : null;
  });
}

/** see README.md#applying-the-pair-rule */
export function iv25TycHds(
  pull: ReadonlyMap<string, SimbadTycHdRow>, iv25: readonly { tyc: string }[],
): (tyc: string) => readonly number[] {
  const requested = new Set(iv25.map((r) => r.tyc));
  return (tyc) => {
    if (!requested.has(tyc)) {
      throw new Error(`pair rule: owner entry ${tyc} is no IV/25 entry, so SIMBAD's TYC→HD pull need not have asked for it`);
    }
    const row = pull.get(tyc);
    return row === undefined ? [] : hdNumbers(row);
  };
}

/** see README.md#applying-the-pair-rule */
export function simbadRefusedMoves(
  rows: readonly SpineRow[],
  decided: ReadonlyMap<number, PairDecision>,
  shippedHd: (row: number) => number | null,
  tycHds: (tyc: string) => readonly number[],
): Set<number> {
  const byTyc = new Map<string, number>();
  rows.forEach((r, i) => { if (r.tyc !== '') byTyc.set(r.tyc, i); });
  const out = new Set<number>();
  for (const d of decided.values()) {
    if (d.kind !== 'pair-moves') continue;
    const hd = shippedHd(byTyc.get(d.owner)!);
    const named = tycHds(d.owner);
    if (hd !== null && named.length > 0 && !named.includes(hd)) out.add(d.hip);
  }
  return out;
}

/** see README.md#applying-the-pair-rule */
export function applyEveryPairMove(kept: readonly SpineRow[], m: PairLinks): SpineRow[] {
  return applyMoves(kept, m, () => null).rows;
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
      const key = normaliseGjKey(gl);
      if (key !== null && !byKey.has(key)) byKey.set(key, gl);
    }
    derivedOnly('gl', byKey.values(), (v) => m.held.glKeys.has(normaliseGjKey(v)!));
  }
  return out;
}

type LinkKey = DiffersLink['key'];

/** see README.md#the-divergence-ledger */
function differsCells(row: SpineRow, inPair: boolean, m: MergeLinks): MergeDivergence[] {
  const hip = intOf(row.hip);
  const hd = intOf(row.hd);
  const one = (v: number | undefined): number[] => (v === undefined ? [] : [v]);
  const derivedBy = {
    'hip<tyc': () => one(m.links.tycHip.get(row.tyc)),
    'hd<tyc': () => (inPair ? [] : [...(m.links.tycHd.get(row.tyc) ?? [])]),
    'hd<hip': () => [...(m.links.hipHd.get(hip!) ?? [])],
    'hr<hd': () => one(m.hdHr.get(hd!)),
    'gl<hip': () => (m.links.glHip(row.gl) === hip ? [] : m.cns5ByHip.get(hip!) ?? []),
    'gl<hd': () => (m.links.glHd(row.gl) === hd ? [] : m.v70aByHd.get(hd!) ?? []),
  } satisfies Record<LinkKey, () => readonly (number | string)[]>;
  const spine = { hip, hd, hr: intOf(row.hr), gl: row.gl === '' ? null : row.gl } satisfies Record<DiffersLink['to'], number | string | null>;
  const out: MergeDivergence[] = [];
  for (const link of DIFFERS_LINKS) {
    const value = spine[link.to];
    if (value === null || row[link.from] === '') continue;
    const derived: readonly (number | string)[] = derivedBy[link.key]();
    if (derived.length === 0 || derived.includes(value)) continue;
    out.push({ kind: 'differs', link, spine: String(value), derived: [...new Set(derived.map(String))].sort() });
  }
  return out;
}

/** `decided` is `applyPairRule`'s verdict on this row, which `row` already carries;
 *  `received`, whether a HIP moved onto it, whose verdict is on the row it left. */
export function mergeDivergences(
  row: SpineRow, m: MergeLinks, decided?: PairDecision, received = false,
): MergeDivergence[] {
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
  if (!received && decided === undefined && pair.divergence?.kind === 'pair-moves') {
    throw new Error(`pair rule not applied: HIP ${pair.divergence.hip} still on Tycho-2 entry ${row.tyc}`);
  }
  const verdict = received ? null : decided ?? pair.divergence;
  return [
    ...unlinked,
    ...(verdict === null ? [] : [verdict]),
    ...derivedOnlyCells(row, pair.hip, m),
    ...differsCells(row, received || verdict !== null, m),
  ];
}
