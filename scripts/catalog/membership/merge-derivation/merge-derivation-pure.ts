// Each spine row's merge decision held against what the primaries' own links derive, row by row: the divergences the switch off the spine must settle. See README.md.

import {
  linkTablesFrom, partitionRow, type KeyCell, type LinkTables,
} from '../../spine/association-audit-pure';
import { rowIndexByTyc, spineIds, type SpineIds, type SpineRow } from '../../spine/inherited-spine-pure';
import type { PrimaryTables, SpineKeys } from '../../spine/primaries-audit-pure';
import { normaliseGjKey } from '../../simbad/simbad-namespace-ladder-pure';
import type { GlieseRow } from '../../gliese-parse-pure';
import { confirmsLabel, formatGlieseDisplay } from '../../classic-ids/label-merge/label-merge-pure';
import type { ManifestRecord } from '../membership-manifest-tsv';
import {
  closePairHdVerdict, type ClosePairVerdict, type ClosePairWitnesses,
} from '../../simbad/close-pair-hd-pure';
import { cns5Gl } from '../additions/addition-items-pure';
import { hdNumbers, type SimbadTycHdRow } from '../../simbad/simbad-tyc-hd-parse';
import type { PairReviewReason } from '../ledger-rows-pure';
import type { BindingDispositionBasis } from '../binding/binding-review-dispositions-pure';
import type { PairDisposition } from '../pair-review-dispositions-pure';


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
type DiffersCell = DiffersLink['to'];

/** What settles a differs cell without review, per cell. see README.md#settling-a-differs-cell */
export const DIFFERS_SETTLEMENTS_BY_CELL = {
  hip: [],
  hd: ['close-pair-uncontested', 'close-pair-refuse'],
  hr: ['v50-pair'],
  gl: ['cns5-source'],
} as const satisfies Record<DiffersCell, readonly string[]>;
export type DiffersSettlement<C extends DiffersCell = DiffersCell> = (typeof DIFFERS_SETTLEMENTS_BY_CELL)[C][number];
type DiffersQueueReason =
  | 'close-pair-unanswered' | 'close-pair-split' | 'close-pair-source-silent' | 'close-pair-move' | 'no-rule';
export type DiffersVerdict<C extends DiffersCell = DiffersCell> =
  | { readonly settled: DiffersSettlement<C> }
  | { readonly queued: DiffersQueueReason };

type DiffersOf<L extends DiffersLink> = {
  readonly kind: 'differs';
  readonly link: L;
  /** The value the record ships in the cell; null where a label rule emptied the spine's. */
  readonly ships: string | null;
  readonly derived: readonly string[];
  readonly verdict: DiffersVerdict<L['to']>;
};
type Differs = { [K in DiffersLink['key']]: DiffersOf<Extract<DiffersLink, { key: K }>> }[DiffersLink['key']];

export type MergeDivergence =
  | { readonly kind: 'unlinked'; readonly cells: readonly KeyCell[]; readonly witnessed: string; readonly published: string }
  | { readonly kind: 'pair-confirmed'; readonly hip: number; readonly owner: string; readonly witness: PairWitness }
  | {
    readonly kind: 'pair-moves';
    readonly hip: number;
    readonly owner: string;
    readonly witness: PairWitness;
    /** `record` when the owner entry is another spine record's, which takes the HIP. */
    readonly onto: PairMoveTarget;
  }
  | { readonly kind: 'pair-review'; readonly hip: number; readonly entries: readonly string[]; readonly reason: PairReviewReason }
  | {
    readonly kind: 'pair-disposed';
    readonly hip: number;
    readonly keep: string;
    readonly basis: BindingDispositionBasis;
    readonly onto: PairDisposedTarget;
  }
  | { readonly kind: 'derived-only'; readonly cell: DerivedOnlyCell; readonly value: string; readonly held: HeldState }
  | Differs;

/** What named the pair's owner entry. see README.md#connected-is-not-unique--the-pair-rule */
export type PairWitness = { readonly by: 'gaia'; readonly sourceId: string };

export const PAIR_MOVE_TARGETS = ['entry', 'record'] as const;
export type PairMoveTarget = (typeof PAIR_MOVE_TARGETS)[number];
/** `stays` when the disposition keeps the entry the row already sits on. */
export const PAIR_DISPOSED_TARGETS = ['stays', ...PAIR_MOVE_TARGETS] as const;
export type PairDisposedTarget = (typeof PAIR_DISPOSED_TARGETS)[number];
/** What `applyPairRule` decided on a row the Gaia test would move, or a disposition settled. */
export type PairDecision = Extract<MergeDivergence, { kind: 'pair-moves' | 'pair-review' | 'pair-disposed' }>;

export interface PairLinks {
  links: LinkTables;
  /** Tycho-2's own `hip` column, inverted: every entry naming the HIP. */
  hipEntries: ReadonlyMap<number, readonly string[]>;
  hdHr: ReadonlyMap<number, number>;
  /** CNS5's rows by their `hip`, in the record's GJ form. */
  cns5ByHip: ReadonlyMap<number, readonly string[]>;
  /** V/70A's rows by their `HD`, in the record's GJ form. */
  v70aByHd: ReadonlyMap<number, readonly string[]>;
  /** CNS5's rows by their own Gaia source, in the record's GJ form. */
  cns5BySource: ReadonlyMap<string, readonly string[]>;
}

export interface MergeLinks extends PairLinks {
  held: SpineKeys;
  closePair: ClosePairWitnesses;
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
  const cns5BySource = new Map<string, string[]>();
  for (const r of tables.cns5) {
    if (r.hip !== null) push(cns5ByHip, r.hip, cns5Gl(r)!);
    if (r.gaiaSourceId !== null) push(cns5BySource, r.gaiaSourceId, cns5Gl(r)!);
  }
  const v70aByHd = new Map<number, string[]>();
  for (const r of tables.gliese.byKey.values()) if (r.hd !== null) push(v70aByHd, r.hd, v70aGl(r));
  return {
    links,
    hipEntries,
    hdHr: hdToHr(links.hrHd),
    cns5ByHip,
    v70aByHd,
    cns5BySource,
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
): { owner: string; witness: PairWitness } | { reason: PairReviewReason } {
  const sourceId = links.sourceOf.hip(hip);
  if (sourceId === null) return { reason: 'no_hip_source' };
  const matches = entries.filter((tyc) => links.sourceOf.tyc(tyc) === sourceId);
  if (matches.length === 0) return { reason: 'no_entry_matches' };
  if (matches.length > 1) return { reason: 'several_match' };
  return { owner: matches[0], witness: { by: 'gaia', sourceId } };
}

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
      ? { kind: 'pair-confirmed', hip, owner: verdict.owner, witness: verdict.witness }
      : { kind: 'pair-moves', hip, owner: verdict.owner, witness: verdict.witness, onto: 'entry' },
    hip,
  };
}

type PairMove = Extract<MergeDivergence, { kind: 'pair-moves' }>;
type PairRuleResult = {
  rows: SpineRow[];
  decided: ReadonlyMap<number, PairDecision>;
  /** Rows a HIP moved onto from another spine record. */
  received: ReadonlySet<number>;
  /** HIPs a disposition settled. */
  disposed: ReadonlySet<number>;
};

/** see README.md#disposing-a-queued-pair */
function requireDispositionsUsed(dispositions: ReadonlyMap<number, PairDisposition>, disposed: ReadonlySet<number>): void {
  for (const hip of dispositions.keys()) {
    if (!disposed.has(hip)) throw new Error(`pair-review disposition names HIP ${hip}, which the pair rule does not queue`);
  }
}

/** Which rows a disposition settles: only those the pair rule queues, or every row it names (the astrometry request's arrangement).
 *  see README.md#disposing-a-queued-pair */
type DispositionScope = 'queued' | 'every';

function applyMoves(
  kept: readonly SpineRow[],
  m: PairLinks,
  dispositions: ReadonlyMap<number, PairDisposition>,
  scope: DispositionScope,
  refusal: (move: PairMove, receiver: SpineRow) => PairReviewReason | null,
): PairRuleResult {
  const rows = [...kept];
  const byTyc = rowIndexByTyc(kept);
  const decided = new Map<number, PairDecision>();
  const received = new Set<number>();
  const owners = new Set<string>();
  const disposed = new Set<number>();
  const receiverOf = (row: SpineRow, hip: number, owner: string): { j: number | undefined; receiver: SpineRow } => {
    const j = byTyc.get(owner);
    if (j !== undefined && kept[j].hip !== '') {
      throw new Error(`pair rule: HIP ${hip} moves onto ${owner}, whose spine record carries HIP ${kept[j].hip}`);
    }
    return { j, receiver: j === undefined ? { ...row, tyc: owner } : { ...kept[j], hip: String(hip) } };
  };
  const place = (i: number, owner: string, { j, receiver }: ReturnType<typeof receiverOf>): PairMoveTarget => {
    if (owners.has(owner)) throw new Error(`pair rule: two HIPs move onto Tycho-2 entry ${owner}`);
    owners.add(owner);
    if (j === undefined) {
      rows[i] = receiver;
      return 'entry';
    }
    rows[i] = { ...rows[i], hip: '' };
    rows[j] = receiver;
    received.add(j);
    return 'record';
  };
  kept.forEach((row, i) => {
    const verdict = pairVerdict(row, spineIds(row).hip, m).divergence;
    if (verdict?.kind !== 'pair-moves' && verdict?.kind !== 'pair-review') return;
    const { hip } = verdict;
    const entries = m.hipEntries.get(hip)!;
    const reason = verdict.kind === 'pair-review'
      ? verdict.reason
      : refusal(verdict, receiverOf(row, hip, verdict.owner).receiver);
    const d = dispositions.get(hip);
    if (d !== undefined && (reason !== null || scope === 'every')) {
      if ([...d.entries].sort().join('|') !== entries.join('|')) {
        throw new Error(`pair-review disposition for HIP ${hip} restates ${d.entries.join('|')}, but the pair is ${entries.join('|')}: review it again`);
      }
      disposed.add(hip);
      const onto = d.keepEntry === row.tyc ? 'stays' : place(i, d.keepEntry, receiverOf(row, hip, d.keepEntry));
      decided.set(i, { kind: 'pair-disposed', hip, keep: d.keepEntry, basis: d.basis, onto });
      return;
    }
    if (verdict.kind === 'pair-review') return;
    if (reason !== null) {
      decided.set(i, { kind: 'pair-review', hip, entries, reason });
      return;
    }
    const onto = place(i, verdict.owner, receiverOf(row, hip, verdict.owner));
    decided.set(i, onto === 'entry' ? verdict : { ...verdict, onto });
  });
  return { rows, decided, received, disposed };
}

/** One pass of the pair rule; a disposition it leaves unused is `settlePairRule`'s to refuse.
 *  see README.md#applying-the-pair-rule */
export function applyPairRule(
  kept: readonly SpineRow[],
  m: PairLinks,
  binds: (row: SpineRow) => string | null,
  refused: ReadonlySet<number>,
  dispositions: ReadonlyMap<number, PairDisposition>,
): PairRuleResult {
  return applyMoves(kept, m, dispositions, 'queued', (move, receiver) => {
    if (binds(receiver) !== move.witness.sourceId) return 'gate_refused';
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
  const byTyc = rowIndexByTyc(rows);
  const out = new Set<number>();
  for (const d of decided.values()) {
    if (d.kind !== 'pair-moves') continue;
    const hd = shippedHd(byTyc.get(d.owner)!);
    const named = tycHds(d.owner);
    if (hd !== null && named.length > 0 && !named.includes(hd)) out.add(d.hip);
  }
  return out;
}

/** The pair rule to its fixed point under the SIMBAD check: `downstream` carries one pass's rows to the HDs they ship.
 *  see README.md#applying-the-pair-rule */
export function settlePairRule<T>(
  kept: readonly SpineRow[],
  m: PairLinks,
  binds: (row: SpineRow) => string | null,
  dispositions: ReadonlyMap<number, PairDisposition>,
  tycHds: (tyc: string) => readonly number[],
  downstream: (rows: readonly SpineRow[]) => { value: T; shippedHd: (row: number) => number | null },
): PairRuleResult & { value: T } {
  const refused = new Set<number>();
  for (;;) {
    const pair = applyPairRule(kept, m, binds, refused, dispositions);
    const { value, shippedHd } = downstream(pair.rows);
    const newlyRefused = simbadRefusedMoves(pair.rows, pair.decided, shippedHd, tycHds);
    if (newlyRefused.size === 0) {
      requireDispositionsUsed(dispositions, pair.disposed);
      return { ...pair, value };
    }
    for (const hip of newlyRefused) refused.add(hip);
  }
}

/** see README.md#applying-the-pair-rule */
export function applyEveryPairMove(
  kept: readonly SpineRow[], m: PairLinks, dispositions: ReadonlyMap<number, PairDisposition>,
): SpineRow[] {
  const { rows, disposed } = applyMoves(kept, m, dispositions, 'every', () => null);
  requireDispositionsUsed(dispositions, disposed);
  return rows;
}

/** Each cell the spine row leaves empty that a primary's link fills, from the row's derived HIP. */
function derivedOnlyCells(row: SpineRow, { hd }: SpineIds, hip: number | null, m: MergeLinks): MergeDivergence[] {
  const out: MergeDivergence[] = [];
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

/** The record as the spine side ships it: what `differs` holds the primaries' links against. */
export type ShippedCells = Pick<ManifestRecord, 'tyc' | 'hip' | 'hd' | 'hdAlt' | 'hr' | 'hrAlt' | 'gl' | 'gaiaSourceId'>;

const CLOSE_PAIR_QUEUE = {
  unanswered: 'close-pair-unanswered',
  split: 'close-pair-split',
  'source-silent': 'close-pair-source-silent',
  move: 'close-pair-move',
} as const satisfies Partial<Record<ClosePairVerdict, DiffersQueueReason>>;

/** see README.md#settling-a-differs-cell */
const DIFFERS_VERDICT: { [C in DiffersCell]: (shipped: ShippedCells, m: MergeLinks) => DiffersVerdict<C> } = {
  hd: (shipped, m) => {
    const kind = closePairHdVerdict(shipped, m.closePair);
    if (kind === 'uncontested') return { settled: 'close-pair-uncontested' };
    if (kind === 'refuse') return { settled: 'close-pair-refuse' };
    return { queued: CLOSE_PAIR_QUEUE[kind] };
  },
  hr: (shipped, m) =>
    shipped.hd !== null && m.hdHr.get(shipped.hd) === shipped.hr ? { settled: 'v50-pair' } : { queued: 'no-rule' },
  gl: (shipped, m) => {
    const own = shipped.gaiaSourceId === null ? [] : m.cns5BySource.get(shipped.gaiaSourceId) ?? [];
    const gl = shipped.gl;
    return gl !== null && own.some((c) => confirmsLabel('gl', c, gl)) ? { settled: 'cns5-source' } : { queued: 'no-rule' };
  },
  hip: () => ({ queued: 'no-rule' }),
};

function differsOf<L extends DiffersLink>(
  link: L, ships: string | null, derived: readonly string[], shipped: ShippedCells, m: MergeLinks,
): DiffersOf<L> {
  const verdict: (s: ShippedCells, m: MergeLinks) => DiffersVerdict<L['to']> = DIFFERS_VERDICT[link.to];
  return { kind: 'differs', link, ships, derived, verdict: verdict(shipped, m) };
}

/** see README.md#the-divergence-ledger */
function differsCells(
  row: SpineRow, { hip, hd }: SpineIds, shipped: ShippedCells, inPair: boolean, m: MergeLinks,
): MergeDivergence[] {
  const one = (v: number | undefined): number[] => (v === undefined ? [] : [v]);
  const derivedBy = {
    'hip<tyc': () => one(m.links.tycHip.get(row.tyc)),
    'hd<tyc': () => (inPair ? [] : [...(m.links.tycHd.get(row.tyc) ?? [])]),
    'hd<hip': () => [...(m.links.hipHd.get(hip!) ?? [])],
    'hr<hd': () => one(m.hdHr.get(hd!)),
    'gl<hip': () => (m.links.glHip(row.gl) === hip ? [] : m.cns5ByHip.get(hip!) ?? []),
    'gl<hd': () => (m.links.glHd(row.gl) === hd ? [] : m.v70aByHd.get(hd!) ?? []),
  } satisfies Record<LinkKey, () => readonly (number | string)[]>;
  const answersTo = {
    hip: shipped.hip === null ? [] : [String(shipped.hip)],
    hd: [shipped.hd, ...shipped.hdAlt].filter((v) => v !== null).map(String),
    hr: [shipped.hr, ...shipped.hrAlt].filter((v) => v !== null).map(String),
    gl: shipped.gl === null ? [] : [shipped.gl],
  } satisfies Record<DiffersLink['to'], readonly string[]>;
  const out: MergeDivergence[] = [];
  for (const link of DIFFERS_LINKS) {
    const held = answersTo[link.to];
    if (row[link.from] === '' || row[link.to] === '') continue;
    const derived = [...new Set(derivedBy[link.key]().map(String))].sort();
    if (derived.length === 0 || derived.some((d) => held.some((h) => confirmsLabel(link.to, d, h)))) continue;
    out.push(differsOf(link, held[0] ?? null, derived, shipped, m) as Differs);
  }
  return out;
}

/** `decided` is `applyPairRule`'s verdict on this row, which `row` already carries;
 *  `received`, whether a HIP moved onto it, whose verdict is on the row it left. */
export function mergeDivergences(
  row: SpineRow, shipped: ShippedCells, m: MergeLinks, decided?: PairDecision, received = false,
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
  const ids = spineIds(row);
  const pair = pairVerdict(row, ids.hip, m);
  if (!received && decided === undefined && pair.divergence?.kind === 'pair-moves') {
    throw new Error(`pair rule not applied: HIP ${pair.divergence.hip} still on Tycho-2 entry ${row.tyc}`);
  }
  const verdict = received ? null : decided ?? pair.divergence;
  return [
    ...unlinked,
    ...(verdict === null ? [] : [verdict]),
    ...derivedOnlyCells(row, ids, pair.hip, m),
    ...differsCells(row, ids, shipped, received || verdict !== null, m),
  ];
}
