import { describe, expect, it } from 'vitest';

import { SPINE_COLUMNS, type SpineRow } from '../../spine/inherited-spine-pure';
import type { LinkTables } from '../../spine/association-audit-pure';
import { spineKeys } from '../../spine/primaries-audit-pure';
import {
  applyEveryPairMove, applyPairRule, hdToHr, iv25TycHds, mergeDivergences, pairOwner, settlePairRule, simbadRefusedMoves,
  type MergeDivergence, type MergeLinks, type PairDecision, type ShippedCells,
} from './merge-derivation-pure';
import type { PairDisposition } from '../pair-review-dispositions-pure';
import { skyPositionAtEpoch } from '../../../../src/astro-core/equatorial-basis';
import { TYCHO2_MEAN_EPOCH } from '../../tycho2-parse';
import { tycho2Row } from '../../tycho2-fixture';

function row(cells: Partial<SpineRow>): SpineRow {
  const out = {} as SpineRow;
  for (const c of SPINE_COLUMNS) out[c] = cells[c] ?? '';
  return out;
}

const A = '1-1-1';
const B = '1-1-2';

function links(tycSources: Record<string, string>, hipSource: string | null = 'S1'): LinkTables {
  return {
    tycHd: new Map([[B, new Set([100])], ['2-2-2', new Set([300])]]),
    tycHip: new Map([[A, 10], [B, 10], ['2-2-2', 20]]),
    hipHd: new Map([[10, new Set([100])]]),
    hrHd: new Map([[7, 100]]),
    glHip: () => null,
    glHd: () => null,
    sourceOf: {
      tyc: (tyc) => tycSources[tyc] ?? null,
      hip: (hip) => (hip === 10 ? hipSource : null),
      gl: () => null,
    },
    simbad: () => undefined,
  };
}

function mergeLinks(l: LinkTables, spine: readonly SpineRow[] = []): MergeLinks {
  return {
    links: l,
    hipEntries: new Map([[10, [A, B]], [20, ['2-2-2']]]),
    hdHr: new Map([[100, 7], [300, 9]]),
    cns5ByHip: new Map([[20, ['GJ 1234']]]),
    v70aByHd: new Map([[300, ['GJ 1234']]]),
    cns5BySource: new Map(),
    held: spineKeys(spine),
    closePair: { iv25Hds: () => undefined, simbadTycHd: new Map(), simbadObjectOf: () => undefined },
    positional: { v70a: () => null, tycho2: () => undefined },
  };
}

const num = (cell: string): number | null => (cell === '' ? null : Number(cell));

/** The row shipped with the labels it carries, as when the label merge moves none. */
function shippedAsIs(r: SpineRow): ShippedCells {
  return {
    tyc: r.tyc === '' ? null : r.tyc, hip: num(r.hip), hd: num(r.hd), hr: num(r.hr),
    gl: r.gl === '' ? null : r.gl, hdAlt: [], hrAlt: [], gaiaSourceId: r.gaia_source_id === '' ? null : r.gaia_source_id,
  };
}

function divergences(
  r: SpineRow, m: MergeLinks, decided?: PairDecision, received = false, shipped = shippedAsIs(r),
): MergeDivergence[] {
  return mergeDivergences(r, shipped, m, decided, received);
}

describe('hdToHr', () => {
  it('refuses an HD V/50 gives to two HRs', () => {
    expect(hdToHr(new Map([[7, 100], [8, 200]]))).toEqual(new Map([[100, 7], [200, 8]]));
    expect(() => hdToHr(new Map([[7, 100], [8, 100]]))).toThrow(/HD 100 to both HR 7 and HR 8/);
  });
});

describe('pairOwner', () => {
  it('names the entry whose Gaia neighbour is the HIP\'s', () => {
    expect(pairOwner(10, [A, B], links({ [A]: 'S0', [B]: 'S1' }))).toEqual({ owner: B, sourceId: 'S1' });
  });

  it('names no owner without a HIP source, a matching entry, or with two', () => {
    expect(pairOwner(10, [A, B], links({ [A]: 'S1' }, null))).toEqual({ reason: 'no_hip_source' });
    expect(pairOwner(10, [A, B], links({ [A]: 'S0' }))).toEqual({ reason: 'no_entry_matches' });
    expect(pairOwner(10, [A, B], links({ [A]: 'S1', [B]: 'S1' }))).toEqual({ reason: 'several_match' });
  });
});

/** A binding derivation that ships each entry's own Gaia source, as `links` names it. */
const bindsOwn = (l: LinkTables) => (r: SpineRow): string | null => (r.tyc === '' ? null : l.sourceOf.tyc(r.tyc));

describe('applyPairRule', () => {
  it('moves a record onto the entry the HIP\'s Gaia source sits on, keeping its other cells', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100', hr: '7' })];
    const l = links({ [B]: 'S1' });
    const { rows, decided } = applyPairRule(kept, mergeLinks(l), bindsOwn(l), new Set(), new Map());
    expect(rows).toEqual([row({ tyc: B, hip: '10', hd: '100', hr: '7' })]);
    expect(decided).toEqual(new Map([[0, { kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1', onto: 'entry' }]]));
    expect(kept[0].tyc).toBe(A);
  });

  it('moves the HIP alone onto another spine record sitting on the owner entry', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: B, hd: '200' })];
    const l = links({ [B]: 'S1' });
    const { rows, decided } = applyPairRule(kept, mergeLinks(l), bindsOwn(l), new Set(), new Map());
    expect(rows).toEqual([row({ tyc: A, hd: '100' }), row({ tyc: B, hip: '10', hd: '200' })]);
    expect(decided).toEqual(new Map([[0, { kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1', onto: 'record' }]]));
  });

  it('reports a moved HIP once, on the row it left, and no verdict on the record it moved onto', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: B, hd: '200' })];
    const l = links({ [B]: 'S1' });
    const { rows, received } = applyPairRule(kept, mergeLinks(l), bindsOwn(l), new Set(), new Map());
    expect(received).toEqual(new Set([1]));
    const pairKinds = (i: number) => divergences(rows[i], mergeLinks(l, rows), undefined, received.has(i))
      .filter((d) => d.kind.startsWith('pair-'));
    expect(pairKinds(1)).toEqual([]);
    expect(divergences(rows[1], mergeLinks(l, rows)).map((d) => d.kind)).toContain('pair-confirmed');
  });

  it('refuses a move onto a spine record that already carries a HIP', () => {
    const kept = [row({ tyc: A, hip: '10' }), row({ tyc: B, hip: '11' })];
    const l = links({ [B]: 'S1' });
    expect(() => applyPairRule(kept, mergeLinks(l), bindsOwn(l), new Set(), new Map()))
      .toThrow(/HIP 10 moves onto 1-1-2, whose spine record carries HIP 11/);
  });

  it('leaves confirmed and queued pairs where the spine put them', () => {
    const kept = [row({ tyc: A, hip: '10' })];
    const confirmed = links({ [A]: 'S1' });
    expect(applyPairRule(kept, mergeLinks(confirmed), bindsOwn(confirmed), new Set(), new Map()).rows).toEqual(kept);
    const queued = links({}, null);
    expect(applyPairRule(kept, mergeLinks(queued), bindsOwn(queued), new Set(), new Map()).decided.size).toBe(0);
  });

  it('queues a move whose moved record the binding gates refuse the HIP\'s source, leaving the row as it was', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' })];
    const { rows, decided } = applyPairRule(kept, mergeLinks(links({ [B]: 'S1' })), () => null, new Set(), new Map());
    expect(rows).toEqual(kept);
    expect(decided).toEqual(new Map([[0, { kind: 'pair-review', hip: 10, entries: [A, B], reason: 'gate_refused' }]]));
    expect(divergences(kept[0], mergeLinks(links({ [B]: 'S1' })), decided.get(0)))
      .toContainEqual({ kind: 'pair-review', hip: 10, entries: [A, B], reason: 'gate_refused' });
  });

  it('queues a move SIMBAD refused, leaving the row as it was; the gates are weighed first', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' })];
    const l = links({ [B]: 'S1' });
    const refused = new Set([10]);
    expect(applyPairRule(kept, mergeLinks(l), bindsOwn(l), refused, new Map())).toEqual({
      rows: kept,
      decided: new Map([[0, { kind: 'pair-review', hip: 10, entries: [A, B], reason: 'simbad_refused' }]]),
      received: new Set(),
      disposed: new Set(),
    });
    expect(applyPairRule(kept, mergeLinks(l), () => null, refused, new Map()).decided.get(0))
      .toEqual({ kind: 'pair-review', hip: 10, entries: [A, B], reason: 'gate_refused' });
  });
});

describe('applyPairRule with dispositions', () => {
  const dispose = (keepEntry: string, entries: string[] = [A, B]): ReadonlyMap<number, PairDisposition> => new Map([
    [10, { hip: 10, entries, keepEntry, basis: 'tycho2_position' as const, evidence: 'sep 0.2"' }],
  ]);
  const queued = links({}, null);

  it('puts a queued HIP on the entry its disposition keeps, as the authority', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' })];
    const { rows, decided } = applyPairRule(kept, mergeLinks(queued), () => null, new Set(), dispose(B));
    expect(rows).toEqual([row({ tyc: B, hip: '10', hd: '100' })]);
    const settled = { kind: 'pair-disposed', hip: 10, keep: B, basis: 'tycho2_position', onto: 'entry' };
    expect(decided).toEqual(new Map([[0, settled]]));
    expect(divergences(rows[0], mergeLinks(queued), decided.get(0))).toContainEqual(settled);
  });

  it('keeps the row where it is when the disposition names its own entry', () => {
    const kept = [row({ tyc: A, hip: '10' })];
    const { rows, decided } = applyPairRule(kept, mergeLinks(queued), () => null, new Set(), dispose(A));
    expect(rows).toEqual(kept);
    expect(decided.get(0)).toMatchObject({ kind: 'pair-disposed', onto: 'stays' });
  });

  it('settles a move the gates refused without weighing it again', () => {
    const kept = [row({ tyc: A, hip: '10' })];
    const { rows } = applyPairRule(kept, mergeLinks(links({ [B]: 'S1' })), () => null, new Set(), dispose(B));
    expect(rows).toEqual([row({ tyc: B, hip: '10' })]);
  });

  it('moves the HIP onto another spine record\'s entry, which then reports no verdict of its own', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: B, hd: '200' })];
    const { rows, decided, received } = applyPairRule(kept, mergeLinks(queued), () => null, new Set(), dispose(B));
    expect(rows).toEqual([row({ tyc: A, hd: '100' }), row({ tyc: B, hip: '10', hd: '200' })]);
    expect(decided.get(0)).toMatchObject({ kind: 'pair-disposed', onto: 'record' });
    expect(received).toEqual(new Set([1]));
  });

  it('refuses a disposition over a pair it no longer restates', () => {
    const kept = [row({ tyc: A, hip: '10' })];
    expect(() => applyPairRule(kept, mergeLinks(queued), () => null, new Set(), dispose(B, [A, '1-1-9'])))
      .toThrow('restates 1-1-1|1-1-9, but the pair is 1-1-1|1-1-2');
  });

  it('applies a disposition over every arrangement the request covers', () => {
    const kept = [row({ tyc: A, hip: '10' })];
    expect(applyEveryPairMove(kept, mergeLinks(links({ [B]: 'S1' })), dispose(A))).toEqual(kept);
    expect(() => applyEveryPairMove(kept, mergeLinks(links({ [A]: 'S1' })), dispose(A)))
      .toThrow(/names HIP 10, which the pair rule does not queue/);
  });
});

describe('settlePairRule', () => {
  const dispose = (keepEntry: string): ReadonlyMap<number, PairDisposition> => new Map([
    [10, { hip: 10, entries: [A, B], keepEntry, basis: 'tycho2_position' as const, evidence: 'sep 0.2"' }],
  ]);
  const shipsOwnHd = (rows: readonly SpineRow[]) => ({ value: rows, shippedHd: (i: number) => Number(rows[i].hd) });
  const named = (hds: Record<string, number[]>) => (tyc: string): readonly number[] => hds[tyc] ?? [];
  const kept = [row({ tyc: A, hip: '10', hd: '100' })];

  it('queues a move SIMBAD refuses on a later pass, and stops when no move is refused', () => {
    const l = links({ [B]: 'S1' });
    const settled = settlePairRule(kept, mergeLinks(l), bindsOwn(l), new Map(), named({ [B]: [101] }), shipsOwnHd);
    expect(settled.value).toEqual(kept);
    expect(settled.decided.get(0)).toEqual({ kind: 'pair-review', hip: 10, entries: [A, B], reason: 'simbad_refused' });
  });

  it('applies a disposition of a SIMBAD-refused HIP, which only the later pass queues', () => {
    const l = links({ [B]: 'S1' });
    const settled = settlePairRule(kept, mergeLinks(l), bindsOwn(l), dispose(A), named({ [B]: [101] }), shipsOwnHd);
    expect(settled.rows).toEqual(kept);
    expect(settled.decided.get(0)).toEqual({ kind: 'pair-disposed', hip: 10, keep: A, basis: 'tycho2_position', onto: 'stays' });
  });

  it('refuses a disposition on a HIP the settled rule does not queue', () => {
    const moved = links({ [B]: 'S1' });
    expect(() => settlePairRule(kept, mergeLinks(moved), bindsOwn(moved), dispose(B), named({}), shipsOwnHd))
      .toThrow(/names HIP 10, which the pair rule does not queue/);
    const confirmed = links({ [A]: 'S1' });
    expect(() => settlePairRule(kept, mergeLinks(confirmed), bindsOwn(confirmed), dispose(A), named({}), shipsOwnHd))
      .toThrow(/names HIP 10, which the pair rule does not queue/);
  });
});

describe('simbadRefusedMoves', () => {
  const tycHds = (named: Record<string, number[]>) => (tyc: string): readonly number[] => named[tyc] ?? [];

  it('refuses a move whose record ships an HD SIMBAD does not name its new entry by', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' })];
    const l = links({ [B]: 'S1' });
    const { rows, decided } = applyPairRule(kept, mergeLinks(l), bindsOwn(l), new Set(), new Map());
    const refusedWhen = (hd: number | null, named: Record<string, number[]>) => (
      simbadRefusedMoves(rows, decided, () => hd, tycHds(named))
    );
    expect(refusedWhen(100, { [B]: [101] })).toEqual(new Set([10]));
    expect(refusedWhen(100, { [B]: [100, 101] })).toEqual(new Set());
    expect(refusedWhen(100, {})).toEqual(new Set());
    expect(refusedWhen(null, { [B]: [101] })).toEqual(new Set());
  });

  it('reads the HD of the record the HIP moved onto', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: B, hd: '200' })];
    const l = links({ [B]: 'S1' });
    const { rows, decided } = applyPairRule(kept, mergeLinks(l), bindsOwn(l), new Set(), new Map());
    const shipped = (i: number) => Number(rows[i].hd);
    expect(simbadRefusedMoves(rows, decided, shipped, tycHds({ [B]: [200] }))).toEqual(new Set());
    expect(simbadRefusedMoves(rows, decided, shipped, tycHds({ [B]: [100] }))).toEqual(new Set([10]));
  });
});

describe('iv25TycHds', () => {
  const pull = new Map([[A, { hdIdents: ['100', '100A', '101B'], simbadOid: 1, mainId: null }]]);
  const read = iv25TycHds(pull, [{ tyc: A }, { tyc: B }]);

  it('names an IV/25 entry\'s HDs, and none where SIMBAD names none', () => {
    expect(read(A)).toEqual([100, 101]);
    expect(read(B)).toEqual([]);
  });

  it('refuses an entry outside IV/25, which the pull need not have asked for', () => {
    expect(() => read('9-9-9')).toThrow(/9-9-9 is no IV\/25 entry/);
  });
});

describe('applyEveryPairMove', () => {
  it('applies a move whatever the binding gates would make of it', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: '2-2-2', hip: '20' })];
    expect(applyEveryPairMove(kept, mergeLinks(links({ [B]: 'S1' })), new Map())).toEqual([
      row({ tyc: B, hip: '10', hd: '100' }), row({ tyc: '2-2-2', hip: '20' }),
    ]);
  });
});

describe('mergeDivergences', () => {
  it('confirms a spine entry the HIP\'s Gaia source sits on', () => {
    const d = divergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [A]: 'S1' })));
    expect(d).toEqual([{ kind: 'pair-confirmed', hip: 10, owner: A, sourceId: 'S1' }]);
  });

  it('refuses a row the pair rule would still move', () => {
    expect(() => divergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [B]: 'S1' }))))
      .toThrow(/pair rule not applied: HIP 10 still on Tycho-2 entry 1-1-1/);
  });

  it('reports the move applied to the row in place of its confirmation', () => {
    const move = { kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1', onto: 'entry' } as const;
    const d = divergences(row({ tyc: B, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [B]: 'S1' })), move);
    expect(d).toEqual([move]);
  });

  it('queues the pair for review when Gaia names no owner', () => {
    const d = divergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({}, null)));
    expect(d).toEqual([{ kind: 'pair-review', hip: 10, entries: [A, B], reason: 'no_hip_source' }]);
  });

  it('derives a shared HIP onto a HIP-less spine entry only when the pair rule names it', () => {
    const owned = divergences(row({ tyc: B }), mergeLinks(links({ [B]: 'S1' })));
    expect(owned).toContainEqual({ kind: 'derived-only', cell: 'hip', value: '10', held: 'free' });
    const other = divergences(row({ tyc: A }), mergeLinks(links({ [B]: 'S1' })));
    expect(other.filter((x) => x.kind === 'derived-only' && x.cell === 'hip')).toEqual([]);
  });

  it('reports each empty cell a primary fills, marking a value another spine row holds', () => {
    const spine = [row({ tyc: '9-9-9', hr: '9' })];
    const d = divergences(row({ tyc: '2-2-2' }), mergeLinks(links({}), spine));
    expect(d).toEqual([
      { kind: 'derived-only', cell: 'hip', value: '20', held: 'free' },
      { kind: 'derived-only', cell: 'hd', value: '300', held: 'free' },
      { kind: 'derived-only', cell: 'hr', value: '9', held: 'held' },
      { kind: 'derived-only', cell: 'gl', value: 'GJ 1234', held: 'free' },
    ]);
  });

  it('reports the identifiers only AT-HYG associates, one divergence per cell', () => {
    const d = divergences(row({ tyc: '2-2-2', hip: '20', hd: '999' }), mergeLinks(links({})));
    expect(d[0]).toEqual({
      kind: 'unlinked', cell: 'hd', witnessed: 'tyc+hip | hd', published: 'tyc+hip | hd',
      verdict: { queued: 'close-pair-unanswered' }, separations: [],
    });
  });

  it('reports a filled cell a primary\'s link fills with other values', () => {
    const d = divergences(row({ tyc: '2-2-2', hip: '20', hd: '999' }), mergeLinks(links({})));
    expect(d.filter((x) => x.kind === 'differs')).toEqual([
      { kind: 'differs', link: { to: 'hd', from: 'tyc', key: 'hd<tyc' }, ships: '999', derived: ['300'], verdict: { queued: 'close-pair-unanswered' } },
    ]);
  });

  it('leaves a pair row\'s TYC-to-HD link to the pair rule, but not its HIP-to-HD link', () => {
    const d = divergences(row({ tyc: B, hip: '10', hd: '555', hr: '7' }), mergeLinks(links({ [B]: 'S1' })));
    expect(d.filter((x) => x.kind === 'differs')).toEqual([
      { kind: 'differs', link: { to: 'hd', from: 'hip', key: 'hd<hip' }, ships: '555', derived: ['100'], verdict: { queued: 'close-pair-unanswered' } },
    ]);
  });

  it('holds the links against the record the label merge ships, not the spine row', () => {
    const spineRow = row({ tyc: '2-2-2', hip: '20', hd: '999' });
    const relabelled = { ...shippedAsIs(spineRow), hd: 300 };
    expect(divergences(spineRow, mergeLinks(links({})), undefined, false, relabelled)
      .filter((x) => x.kind === 'differs')).toEqual([]);
  });

  it('reports a spine cell a label rule emptied, and leaves a cell the spine left empty to derived-only', () => {
    const spineRow = row({ tyc: '2-2-2', hip: '20', hd: '999' });
    const dropped = { ...shippedAsIs(spineRow), hd: null };
    expect(divergences(spineRow, mergeLinks(links({})), undefined, false, dropped)
      .filter((x) => x.kind === 'differs')).toEqual([
      { kind: 'differs', link: { to: 'hd', from: 'tyc', key: 'hd<tyc' }, ships: null, derived: ['300'], verdict: { queued: 'close-pair-unanswered' } },
    ]);
    const empty = row({ tyc: '2-2-2', hip: '20' });
    const filled = { ...shippedAsIs(empty), hd: 999 };
    expect(divergences(empty, mergeLinks(links({})), undefined, false, filled)
      .filter((x) => x.kind === 'differs')).toEqual([]);
  });

  it('counts an HD the record answers to as an alias as agreement', () => {
    const spineRow = row({ tyc: '2-2-2', hip: '20', hd: '999' });
    const aliased = { ...shippedAsIs(spineRow), hdAlt: [300] };
    expect(divergences(spineRow, mergeLinks(links({})), undefined, false, aliased)
      .filter((x) => x.kind === 'differs')).toEqual([]);
  });

  it('compares a GJ on the label merge\'s specificity rule: a system names its component, another component does not', () => {
    const m = { ...mergeLinks(links({})), cns5ByHip: new Map([[20, ['GJ 1234A']]]) };
    const gl = (cell: string) => divergences(row({ tyc: '2-2-2', hip: '20', hd: '300', gl: cell }), m)
      .filter((x) => x.kind === 'differs' && x.link.key === 'gl<hip');
    expect(gl('GJ 1234')).toEqual([]);
    expect(gl('Gl 1234A')).toEqual([]);
    expect(gl('GJ 1234B')).toEqual([
      { kind: 'differs', link: { to: 'gl', from: 'hip', key: 'gl<hip' }, ships: 'GJ 1234B', derived: ['GJ 1234A'], verdict: { queued: 'no-rule' } },
    ]);
  });
});

describe('settling an unlinked cell', () => {
  const unlinked = (r: SpineRow, m: MergeLinks, shipped = shippedAsIs(r)) => divergences(r, m, undefined, false, shipped)
    .flatMap((x) => (x.kind === 'unlinked' ? [x] : []));
  const glRow = row({ tyc: '2-2-2', hip: '20', gl: 'Gl 852.1', gaia_source_id: 'S9' });
  const gl852 = { raB1950Deg: 333.721, decB1950Deg: 15.11, pmArcsecYr: 0.226, pmPaDeg: 105.0 };
  const atJ2000 = (raDeg: number, decDeg: number, pmRaMasyr: number, pmDecMasyr: number) => tycho2Row('2-2-2',
    skyPositionAtEpoch({ raDeg, decDeg }, { pmRaMasyr, pmDecMasyr }, 2016, TYCHO2_MEAN_EPOCH));
  const witnessing = (entry: ReturnType<typeof tycho2Row> | undefined, astrometry: typeof gl852 | null = gl852): MergeLinks => ({
    ...mergeLinks(links({})),
    cns5ByHip: new Map(),
    positional: { v70a: (gl) => (gl === 'Gl 852.1' ? astrometry : null), tycho2: (tyc) => (tyc === '2-2-2' ? entry : undefined) },
  });

  it('settles a GJ whose V/70A position lands on the record\'s own Tycho-2 entry', () => {
    const [d] = unlinked(glRow, witnessing(atJ2000(334.332478354, 15.359376989, 208.0508, -64.0310)));
    expect(d).toMatchObject({ cell: 'gl', verdict: { settled: 'v70a-position' } });
    expect(Number(d.separations[0].separationArcsec.toFixed(1))).toBe(0.7);
  });

  it('queues a GJ the witness finds no entry for, or cannot test, with the reason', () => {
    const far = atJ2000(334.4, 15.4, 208.0508, -64.0310);
    expect(unlinked(glRow, witnessing(far))[0].verdict).toEqual({ queued: 'v70a-none' });
    expect(unlinked(glRow, witnessing(far, null))[0]).toMatchObject({ verdict: { queued: 'no-v70a-astrometry' }, separations: [] });
    expect(unlinked(glRow, witnessing(undefined))[0].verdict).toEqual({ queued: 'no-tycho2-entry' });
  });

  it('settles a GJ CNS5\'s row for the record\'s own source names before the witness runs', () => {
    const m = { ...witnessing(undefined), cns5BySource: new Map([['S9', ['Gl 852.1']]]) };
    expect(unlinked(glRow, m)[0]).toMatchObject({ verdict: { settled: 'cns5-source' }, separations: [] });
  });

  it('settles a cell the label rules moved off the record', () => {
    const hdRow = row({ tyc: '2-2-2', hip: '20', hd: '999' });
    expect(unlinked(hdRow, mergeLinks(links({})), { ...shippedAsIs(hdRow), hd: null })[0].verdict)
      .toEqual({ settled: 'not-shipped' });
  });

  it('judges the spine\'s value where the record ships it only as an alias, not the display HD', () => {
    const hdRow = row({ tyc: '2-2-2', hip: '20', hd: '999' });
    const m = {
      ...mergeLinks(links({})),
      closePair: {
        iv25Hds: (tyc: string) => (tyc === '2-2-2' ? new Set([999]) : undefined),
        simbadTycHd: new Map([['2-2-2', { hdIdents: ['999'], simbadOid: 5, mainId: null }]]),
        simbadObjectOf: () => undefined,
      },
    };
    expect(unlinked(hdRow, m, { ...shippedAsIs(hdRow), hd: 300, hdAlt: [999] })[0].verdict)
      .toEqual({ settled: 'close-pair-uncontested' });
  });

  it('settles an HR V/50 pairs with the shipped HD, and queues a HIP on no rule', () => {
    const hrRow = row({ tyc: '2-2-2', hd: '300', hr: '9' });
    expect(unlinked(hrRow, mergeLinks(links({})))).toMatchObject([{ cell: 'hr', verdict: { settled: 'v50-pair' } }]);
    const hipRow = row({ hip: '77', gl: 'GJ 1234' });
    expect(unlinked(hipRow, mergeLinks(links({})))).toMatchObject([{ cell: 'hip', verdict: { queued: 'no-rule' } }]);
  });
});

describe('settling a differs cell', () => {
  const verdictOf = (r: SpineRow, m: MergeLinks, to: string) => divergences(r, m)
    .flatMap((x) => (x.kind === 'differs' && x.link.to === to ? [x.verdict] : []));
  const closePair = (iv25: number[], simbad: number[], objectOfSource: number) => ({
    iv25Hds: (tyc: string) => (tyc === '2-2-2' ? new Set(iv25) : undefined),
    simbadTycHd: new Map([['2-2-2', { hdIdents: simbad.map(String), simbadOid: 5, mainId: null }]]),
    simbadObjectOf: (s: string) => (s === 'S9' ? objectOfSource : undefined),
  });
  const hdRow = row({ tyc: '2-2-2', hip: '20', hd: '999', gaia_source_id: 'S9' });

  it('runs an HD through the close-pair rule: uncontested and refused stand, the rest queue', () => {
    const at = (iv25: number[], simbad: number[], oid: number) => verdictOf(
      hdRow, { ...mergeLinks(links({})), closePair: closePair(iv25, simbad, oid) }, 'hd',
    );
    expect(at([999], [999], 5)).toEqual([{ settled: 'close-pair-uncontested' }]);
    expect(at([300], [300], 6)).toEqual([{ settled: 'close-pair-refuse' }]);
    expect(at([300], [300], 5)).toEqual([{ queued: 'close-pair-move' }]);
    expect(at([300], [999], 5)).toEqual([{ queued: 'close-pair-split' }]);
  });

  it('settles an HR V/50 pairs with the shipped HD', () => {
    const m = { ...mergeLinks(links({})), hdHr: new Map([[300, 9], [999, 8]]) };
    expect(verdictOf(row({ tyc: '2-2-2', hip: '20', hd: '300', hr: '9' }), m, 'hr')).toEqual([]);
    const moved = row({ tyc: '2-2-2', hip: '20', hd: '300', hr: '9' });
    const shipped = { ...shippedAsIs(moved), hd: 999, hr: 8 };
    expect(divergences(moved, m, undefined, false, shipped)
      .flatMap((x) => (x.kind === 'differs' && x.link.to === 'hr' ? [x.verdict] : [])))
      .toEqual([{ settled: 'v50-pair' }]);
  });

  it('settles a GJ CNS5\'s row for the record\'s own source names', () => {
    const m = {
      ...mergeLinks(links({})),
      cns5ByHip: new Map([[20, ['GJ 1234A']]]),
      cns5BySource: new Map([['S9', ['GJ 1234B']]]),
    };
    expect(verdictOf(row({ tyc: '2-2-2', hip: '20', hd: '300', gl: 'GJ 1234B', gaia_source_id: 'S9' }), m, 'gl'))
      .toEqual([{ settled: 'cns5-source' }]);
  });
});
