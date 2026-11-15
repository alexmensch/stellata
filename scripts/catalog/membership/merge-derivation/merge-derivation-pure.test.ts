import { describe, expect, it } from 'vitest';

import { SPINE_COLUMNS, type SpineRow } from '../../spine/inherited-spine-pure';
import type { LinkTables } from '../../spine/association-audit-pure';
import { spineKeys } from '../../spine/primaries-audit-pure';
import { applyEveryPairMove, applyPairRule, hdToHr, mergeDivergences, pairOwner, type MergeLinks } from './merge-derivation-pure';

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
    held: spineKeys(spine),
  };
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
    const { rows, decided } = applyPairRule(kept, mergeLinks(l), bindsOwn(l));
    expect(rows).toEqual([row({ tyc: B, hip: '10', hd: '100', hr: '7' })]);
    expect(decided).toEqual(new Map([[0, { kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1', onto: 'entry' }]]));
    expect(kept[0].tyc).toBe(A);
  });

  it('moves the HIP alone onto another spine record sitting on the owner entry', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: B, hd: '200' })];
    const l = links({ [B]: 'S1' });
    const { rows, decided } = applyPairRule(kept, mergeLinks(l), bindsOwn(l));
    expect(rows).toEqual([row({ tyc: A, hd: '100' }), row({ tyc: B, hip: '10', hd: '200' })]);
    expect(decided).toEqual(new Map([[0, { kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1', onto: 'record' }]]));
  });

  it('refuses a move onto a spine record that already carries a HIP', () => {
    const kept = [row({ tyc: A, hip: '10' }), row({ tyc: B, hip: '11' })];
    const l = links({ [B]: 'S1' });
    expect(() => applyPairRule(kept, mergeLinks(l), bindsOwn(l)))
      .toThrow(/HIP 10 moves onto 1-1-2, whose spine record carries HIP 11/);
  });

  it('leaves confirmed and queued pairs where the spine put them', () => {
    const kept = [row({ tyc: A, hip: '10' })];
    const confirmed = links({ [A]: 'S1' });
    expect(applyPairRule(kept, mergeLinks(confirmed), bindsOwn(confirmed)).rows).toEqual(kept);
    const queued = links({}, null);
    expect(applyPairRule(kept, mergeLinks(queued), bindsOwn(queued)).decided.size).toBe(0);
  });

  it('queues a move whose moved record the binding gates refuse the HIP\'s source, leaving the row as it was', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' })];
    const { rows, decided } = applyPairRule(kept, mergeLinks(links({ [B]: 'S1' })), () => null);
    expect(rows).toEqual(kept);
    expect(decided).toEqual(new Map([[0, { kind: 'pair-review', hip: 10, entries: [A, B], reason: 'gate_refused' }]]));
    expect(mergeDivergences(kept[0], mergeLinks(links({ [B]: 'S1' })), decided.get(0)))
      .toContainEqual({ kind: 'pair-review', hip: 10, entries: [A, B], reason: 'gate_refused' });
  });
});

describe('applyEveryPairMove', () => {
  it('applies a move whatever the binding gates would make of it', () => {
    const kept = [row({ tyc: A, hip: '10', hd: '100' }), row({ tyc: '2-2-2', hip: '20' })];
    expect(applyEveryPairMove(kept, mergeLinks(links({ [B]: 'S1' })))).toEqual([
      row({ tyc: B, hip: '10', hd: '100' }), row({ tyc: '2-2-2', hip: '20' }),
    ]);
  });
});

describe('mergeDivergences', () => {
  it('confirms a spine entry the HIP\'s Gaia source sits on', () => {
    const d = mergeDivergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [A]: 'S1' })));
    expect(d).toEqual([{ kind: 'pair-confirmed', hip: 10, owner: A, sourceId: 'S1' }]);
  });

  it('refuses a row the pair rule would still move', () => {
    expect(() => mergeDivergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [B]: 'S1' }))))
      .toThrow(/pair rule not applied: HIP 10 still on Tycho-2 entry 1-1-1/);
  });

  it('reports the move applied to the row in place of its confirmation', () => {
    const move = { kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1', onto: 'entry' } as const;
    const d = mergeDivergences(row({ tyc: B, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [B]: 'S1' })), move);
    expect(d).toEqual([move]);
  });

  it('queues the pair for review when Gaia names no owner', () => {
    const d = mergeDivergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({}, null)));
    expect(d).toEqual([{ kind: 'pair-review', hip: 10, entries: [A, B], reason: 'no_hip_source' }]);
  });

  it('derives a shared HIP onto a HIP-less spine entry only when the pair rule names it', () => {
    const owned = mergeDivergences(row({ tyc: B }), mergeLinks(links({ [B]: 'S1' })));
    expect(owned).toContainEqual({ kind: 'derived-only', cell: 'hip', value: '10', held: 'free' });
    const other = mergeDivergences(row({ tyc: A }), mergeLinks(links({ [B]: 'S1' })));
    expect(other.filter((x) => x.kind === 'derived-only' && x.cell === 'hip')).toEqual([]);
  });

  it('reports each empty cell a primary fills, marking a value another spine row holds', () => {
    const spine = [row({ tyc: '9-9-9', hr: '9' })];
    const d = mergeDivergences(row({ tyc: '2-2-2' }), mergeLinks(links({}), spine));
    expect(d).toEqual([
      { kind: 'derived-only', cell: 'hip', value: '20', held: 'free' },
      { kind: 'derived-only', cell: 'hd', value: '300', held: 'free' },
      { kind: 'derived-only', cell: 'hr', value: '9', held: 'held' },
      { kind: 'derived-only', cell: 'gl', value: 'GJ 1234', held: 'free' },
    ]);
  });

  it('reports the identifiers only AT-HYG associates', () => {
    const d = mergeDivergences(row({ tyc: '2-2-2', hip: '20', hd: '999' }), mergeLinks(links({})));
    expect(d[0]).toEqual({ kind: 'unlinked', cells: ['hd'], witnessed: 'tyc+hip | hd', published: 'tyc+hip | hd' });
  });

  it('reports a filled cell a primary\'s link fills with other values', () => {
    const d = mergeDivergences(row({ tyc: '2-2-2', hip: '20', hd: '999' }), mergeLinks(links({})));
    expect(d.filter((x) => x.kind === 'differs')).toEqual([
      { kind: 'differs', link: { to: 'hd', from: 'tyc', key: 'hd<tyc' }, spine: '999', derived: ['300'] },
    ]);
  });

  it('leaves a pair row\'s TYC-to-HD link to the pair rule, but not its HIP-to-HD link', () => {
    const d = mergeDivergences(row({ tyc: B, hip: '10', hd: '555', hr: '7' }), mergeLinks(links({ [B]: 'S1' })));
    expect(d.filter((x) => x.kind === 'differs')).toEqual([
      { kind: 'differs', link: { to: 'hd', from: 'hip', key: 'hd<hip' }, spine: '555', derived: ['100'] },
    ]);
  });
});
