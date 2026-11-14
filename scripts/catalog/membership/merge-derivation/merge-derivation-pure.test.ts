import { describe, expect, it } from 'vitest';

import { SPINE_COLUMNS, type SpineRow } from '../../spine/inherited-spine-pure';
import type { LinkTables } from '../../spine/association-audit-pure';
import { spineKeys } from '../../spine/primaries-audit-pure';
import { mergeDivergences, pairOwner, type MergeLinks } from './merge-derivation-pure';

function row(cells: Partial<SpineRow>): SpineRow {
  const out = {} as SpineRow;
  for (const c of SPINE_COLUMNS) out[c] = cells[c] ?? '';
  return out;
}

const A = '1-1-1';
const B = '1-1-2';

function links(tycSources: Record<string, string>, hipSource: string | null = 'S1'): LinkTables {
  return {
    tycHd: new Map([[B, new Set([100])]]),
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
    tycHip: (tyc) => ({ [A]: 10, [B]: 10, '2-2-2': 20 } as Record<string, number>)[tyc] ?? null,
    tycHds: new Map([[B, [100]], ['2-2-2', [300]]]),
    hipHds: l.hipHd,
    hdHr: new Map([[100, 7], [300, 9]]),
    cns5ByHip: new Map([[20, ['GJ 1234']]]),
    v70aByHd: new Map([[300, ['NN 1234']]]),
    held: spineKeys(spine),
  };
}

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

describe('mergeDivergences', () => {
  it('confirms a spine entry the HIP\'s Gaia source sits on', () => {
    const d = mergeDivergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [A]: 'S1' })));
    expect(d).toEqual([{ kind: 'pair-confirmed', hip: 10, sourceId: 'S1' }]);
  });

  it('moves the record onto the entry the HIP\'s Gaia source sits on', () => {
    const d = mergeDivergences(row({ tyc: A, hip: '10', hd: '100', hr: '7' }), mergeLinks(links({ [B]: 'S1' })));
    expect(d).toEqual([{ kind: 'pair-moves', hip: 10, owner: B, sourceId: 'S1' }]);
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
});
