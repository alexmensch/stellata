import { describe, it, expect } from 'vitest';

import { NO_CONSTELLATION_INDEX } from '../catalog-pure';
import { CON_INDEX } from '../parse/constellations';
import type { ClassicIdOverlay, OverlayEntry } from './classic-id-overlay-pure';
import {
  buildDesignationConIndex,
  resolveDesignationConIndex,
} from './designation-constellation-pure';
import {
  labelFlipDesignationDelta,
  labelFlipsTsv,
  mergeClassicIdLabels,
  parseLabelOverridesTsv,
  spineDesignationsRemovedBy,
  type LabelFlip,
  type LabelMergeRecord,
} from './label-merge-pure';

const SRC_A = '4911306239828325632';
const SRC_B = '4911306239828325760';

function entry(over: Partial<OverlayEntry> = {}): OverlayEntry {
  return { hd: [], hr: [], hip: [], gj: [], bayer: [], flamsteed: [], ...over };
}

function record(over: Partial<LabelMergeRecord> = {}): LabelMergeRecord {
  return {
    gaiaSourceId: SRC_A, hip: null, hd: null, hr: null, gl: null, flam: null,
    hdAlt: [], hrAlt: [],
    ...over,
  };
}

function merge(
  records: LabelMergeRecord[],
  overlay: ClassicIdOverlay,
  overrides = new Map<string, string | null>(),
) {
  return mergeClassicIdLabels({
    records,
    labels: records.map((_, i) => `record ${i}`),
    overlay,
    overrides,
  });
}

describe('mergeClassicIdLabels', () => {
  it('adds an identifier the spine lacks', () => {
    const records = [record()];
    const { counts } = merge(records, new Map([[SRC_A, entry({ hd: [172167] })]]));
    expect(records[0].hd).toBe(172167);
    expect(counts.labelAdded.hd).toBe(1);
    expect(counts.labelFlipped.hd).toBe(0);
  });

  it('keeps the spine spelling where the overlay confirms the value', () => {
    const records = [record({ gl: 'Gl 559A' })];
    const { counts, flips } = merge(
      records, new Map([[SRC_A, entry({ gj: ['559A'] })]]),
    );
    expect(records[0].gl).toBe('Gl 559A');
    expect(counts.labelAgree.gl).toBe(1);
    expect(flips).toEqual([]);
  });

  it('collapses CNS5\'s trailing .0 rather than reading it as a disagreement', () => {
    const records = [record({ gl: 'Gl 18' })];
    const { counts } = merge(records, new Map([[SRC_A, entry({ gj: ['18.0'] })]]));
    expect(records[0].gl).toBe('Gl 18');
    expect(counts.labelAgree.gl).toBe(1);
  });

  it('lets the overlay win on disagreement and enumerates the flip', () => {
    const records = [record({ hr: 5505 })];
    const { counts, flips } = merge(
      records, new Map([[SRC_A, entry({ hr: [5506] })]]),
    );
    expect(records[0].hr).toBe(5506);
    expect(counts.labelFlipped.hr).toBe(1);
    expect(flips).toEqual([{
      sourceId: SRC_A, label: 'record 0', field: 'hr',
      spine: '5505', overlay: '5506', applied: '5506', disposition: 'overlay-wins',
    }]);
  });

  it('keeps the spine value where the overlay asserts none', () => {
    const records = [record({ hd: 10360 })];
    const { counts } = merge(records, new Map([[SRC_A, entry({ hip: [7751] })]]));
    expect(records[0].hd).toBe(10360);
    expect(counts.labelSpineOnly.hd).toBe(1);
  });

  it('counts a record with no overlay row as spine-only per identifier', () => {
    const records = [record({ gaiaSourceId: null, hd: 10360, hip: 7751 })];
    const { counts } = merge(records, new Map());
    expect(counts.labelNoOverlayEntry).toBe(1);
    expect(counts.labelSpineOnly.hd).toBe(1);
    expect(counts.labelSpineOnly.hip).toBe(1);
  });

  it('aliases the values a single-valued field cannot display', () => {
    const records = [record({ hd: 172167 })];
    const { counts, flips } = merge(
      records, new Map([[SRC_A, entry({ hd: [172167, 172168] })]]),
    );
    expect(records[0].hd).toBe(172167);
    expect(records[0].hdAlt).toEqual([172168]);
    expect(counts.labelExtraAlias.hd).toBe(1);
    expect(counts.labelExtraDropped.hd).toBe(0);
    expect(flips.map((f) => [f.applied, f.disposition]))
      .toEqual([['172168', 'extra-alias']]);
  });

  it('aliases every extra value, not just the first', () => {
    const records = [record({ hr: 7001 })];
    const { counts } = merge(
      records, new Map([[SRC_A, entry({ hr: [7001, 7002, 7003] })]]),
    );
    expect(records[0].hr).toBe(7001);
    expect(records[0].hrAlt).toEqual([7002, 7003]);
    expect(counts.labelExtraAlias.hr).toBe(2);
  });

  // gl has no alias list, so its extras stay labels the record will not answer
  // to — the disposition split is what keeps the two outcomes distinguishable.
  it('drops an extra the field has nowhere to carry', () => {
    const records = [record({ gl: 'GJ 559' })];
    const { counts, flips } = merge(
      records, new Map([[SRC_A, entry({ gj: ['559', '560'] })]]),
    );
    expect(counts.labelExtraAlias.gl).toBe(0);
    expect(counts.labelExtraDropped.gl).toBe(1);
    expect(flips.map((f) => [f.applied, f.disposition]))
      .toEqual([['GJ 560', 'extra-dropped']]);
  });

  // An alias adds a designation without displacing the spine's, which is the
  // one place the delta's two questions part company.
  it('an aliased extra adds a designation and removes none', () => {
    const records = [record({ hd: 172167 })];
    const { flips } = merge(
      records, new Map([[SRC_A, entry({ hd: [172167, 172168] })]]),
    );
    expect([...labelFlipDesignationDelta(flips)]).toEqual([['hd:172168', 1]]);
    expect(spineDesignationsRemovedBy(flips)).toEqual([]);
  });

  // The p Eridani / Gl 277A shape: HIP 7751 already keys record A off the
  // spine, so attaching it to B would make it ambiguous and cost BOTH records
  // their SID key (docs/sid.md § 4.1).
  it('withholds an addition that would make another record\'s key ambiguous', () => {
    const records = [record({ hip: 7751, hd: 10360 }), record({
      gaiaSourceId: SRC_B, hd: 10361,
    })];
    const { counts, flips } = merge(records, new Map([
      [SRC_A, entry({ hd: [10360] })],
      [SRC_B, entry({ hd: [10361], hip: [7751] })],
    ]));
    expect(records[0].hip).toBe(7751);
    expect(records[1].hip).toBeNull();
    expect(counts.labelSuppressed.hip).toBe(1);
    expect(flips.map((f) => f.disposition)).toEqual(['suppressed-collision']);
  });

  it('allows a mutual swap, where neither value gains an owner', () => {
    const records = [record({ hd: 4082 }), record({ gaiaSourceId: SRC_B, hd: 4083 })];
    const { counts } = merge(records, new Map([
      [SRC_A, entry({ hd: [4083] })],
      [SRC_B, entry({ hd: [4082] })],
    ]));
    expect([records[0].hd, records[1].hd]).toEqual([4083, 4082]);
    expect(counts.labelFlipped.hd).toBe(2);
    expect(counts.labelSuppressed.hd).toBe(0);
  });

  it('attaches a value the spine already made ambiguous, the policy owning it', () => {
    const records = [
      record({ hd: 205811 }),
      record({ gaiaSourceId: SRC_B, hd: 205811 }),
      record({ gaiaSourceId: '3', hd: null }),
    ];
    const { counts } = merge(records, new Map([['3', entry({ hd: [205811] })]]));
    expect(records[2].hd).toBe(205811);
    expect(counts.labelSuppressed.hd).toBe(0);
    expect(counts.labelAdded.hd).toBe(1);
  });

  it('honours a curated override, both as a value and as keep-the-spine', () => {
    const records = [record({ hd: 4082 }), record({ gaiaSourceId: SRC_B, hr: 5505 })];
    const overrides = parseLabelOverridesTsv(
      'gaia_source_id\tfield\tvalue\n'
      + `${SRC_A}\thd\t99999\n`
      + `${SRC_B}\thr\t\n`,
    );
    const { counts, flips } = merge(records, new Map([
      [SRC_A, entry({ hd: [4083] })],
      [SRC_B, entry({ hr: [5506] })],
    ]), overrides);
    expect(records[0].hd).toBe(99999);
    expect(records[1].hr).toBe(5505);
    expect(counts.labelOverridden.hd).toBe(1);
    expect(counts.labelOverridden.hr).toBe(1);
    expect(flips.map((f) => f.disposition).sort())
      .toEqual(['override-spine', 'override-value']);
  });

  it('rejects an override naming an identifier the merge does not own', () => {
    expect(() => parseLabelOverridesTsv(
      `gaia_source_id\tfield\tvalue\n${SRC_A}\tbayer\talf\n`,
    )).toThrow(/not a merged identifier/);
  });
});

describe('labelFlipsTsv', () => {
  it('writes one row per review item, field-major', () => {
    const records = [record({ hr: 5505, hd: 4082 })];
    const { flips } = merge(records, new Map([
      [SRC_A, entry({ hd: [4083], hr: [5506] })],
    ]));
    const lines = labelFlipsTsv(flips).trimEnd().split('\n');
    expect(lines[0]).toBe(
      'gaia_source_id\tlabel\tfield\tspine\toverlay\tapplied\tdisposition',
    );
    expect(lines.map((l) => l.split('\t')[2])).toEqual(['field', 'hd', 'hr']);
  });
});

describe('spineDesignationsRemovedBy', () => {
  function flip(over: Partial<LabelFlip>): LabelFlip {
    return {
      sourceId: SRC_A, label: 'record 0', field: 'hr',
      spine: '5505', overlay: '5506', applied: '5506',
      disposition: 'overlay-wins', ...over,
    };
  }

  it('reports the spine value of every disposition that writes over it', () => {
    expect(spineDesignationsRemovedBy([
      flip({}),
      flip({ field: 'hd', spine: '10360', applied: '10361', disposition: 'override-value' }),
    ])).toEqual(['hr:5505', 'hd:10360']);
  });

  it('reports nothing where the record keeps the spine value', () => {
    expect(spineDesignationsRemovedBy([
      flip({ applied: '5505', disposition: 'override-spine' }),
      flip({ applied: '5505', disposition: 'suppressed-collision' }),
      flip({ applied: '5507', disposition: 'extra-dropped' }),
      flip({ spine: '', disposition: 'added' }),
      flip({ field: 'flam', spine: '24', applied: '25' }),
    ])).toEqual([]);
  });

  // What separates this from the delta: a designation the merge moves from one
  // record to another still leaves the first record's same-as class, so a
  // ledger row keyed on it needs a bridge — the net-zero delta cannot say so.
  it('reports a designation the delta nets away', () => {
    const moved = [
      flip({ spine: '5505', applied: '5506' }),
      flip({ sourceId: SRC_B, spine: '5506', applied: '5505' }),
    ];
    expect(labelFlipDesignationDelta(moved)).toEqual(new Map([['hr:5506', 0], ['hr:5505', 0]]));
    expect(spineDesignationsRemovedBy(moved)).toEqual(['hr:5505', 'hr:5506']);
  });
});

describe('designation constellation from IV/27A', () => {
  const rows = [
    { hd: 216956, hip: 113368, bayer: 'alf', flamsteed: 24, cst: 'PsA' },
    { hd: 192425, hip: 99742, bayer: 'rho', flamsteed: 67, cst: 'Aql' },
  ];

  it('resolves by HD, then by HIP', () => {
    const { index, counts } = buildDesignationConIndex(rows);
    expect(counts.crossIndexUnknownCst).toBe(0);
    // ρ Aql crossed into Delphinus in 1992 and keeps its Aquila designation.
    expect(resolveDesignationConIndex(index, 192425, null))
      .toBe(CON_INDEX.get('aql'));
    expect(resolveDesignationConIndex(index, null, 113368))
      .toBe(CON_INDEX.get('psa'));
  });

  it('answers NO_CONSTELLATION_INDEX where IV/27A has no row', () => {
    const { index } = buildDesignationConIndex(rows);
    expect(resolveDesignationConIndex(index, 1, 2)).toBe(NO_CONSTELLATION_INDEX);
  });

  it('counts a cst naming no IAU-88 constellation instead of guessing', () => {
    const { index, counts } = buildDesignationConIndex(
      [{ hd: 1, hip: 1, bayer: 'alf', flamsteed: null, cst: 'Xyz' }],
    );
    expect(counts.crossIndexUnknownCst).toBe(1);
    expect(resolveDesignationConIndex(index, 1, 1)).toBe(NO_CONSTELLATION_INDEX);
  });
});
