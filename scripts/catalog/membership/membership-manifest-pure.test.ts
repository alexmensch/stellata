import { describe, expect, it } from 'vitest';

import type { ClassicIdOverlay, OverlayEntry } from '../classic-ids/classic-id-overlay-pure';
import { parseGlieseTsv } from '../gliese-parse';
import { SPINE_COLUMNS, spineDesignations, type SpineRow } from '../spine/inherited-spine-pure';
import type { PrimaryTables } from '../spine/primaries-audit-pure';
import type { Tycho2Row } from '../tycho2-parse';
import {
  ADDITION_REASONS,
  COMPONENT_REASON_PREFIX,
  MANIFEST_COLUMNS,
  buildMembership,
  manifestDesignations,
  manifestKey,
  matchSpineToManifest,
  parseLedgerTsv,
  parseManifestTsv,
  serializeLedger,
  serializeManifest,
  type ManifestRow,
} from './membership-manifest-pure';

function spineRow(cells: Partial<SpineRow>): SpineRow {
  const out = {} as SpineRow;
  for (const c of SPINE_COLUMNS) out[c] = cells[c] ?? '';
  return out;
}

function manifestRow(cells: Partial<ManifestRow>): ManifestRow {
  const out = {} as ManifestRow;
  for (const c of MANIFEST_COLUMNS) out[c] = cells[c] ?? '';
  return out;
}

function tycho2(vtMag: number): Tycho2Row {
  return {
    raDeg: 0, decDeg: 0, epoch: 2000, pmRaMasyr: null, pmDecMasyr: null,
    btMag: null, vtMag, fromIcrs: false, isPhotocentre: false,
  };
}

function entry(e: Partial<OverlayEntry>): OverlayEntry {
  return { hd: [], hr: [], hip: [], gj: [], bayer: [], flamsteed: [], ...e };
}

const GLIESE_TSV = [
  'name\tcomp\tvmag\tbv\tsp\tplx_mas\te_plx_mas\tn_plx',
  'Gl 165\tAB\t9.0\t\t\t\t\t',
].join('\n') + '\n';

/** Spine: Sol; HD 100001 / HIP 10 bound and reproduced by the TYC walk; HD 5
 *  bound by AT-HYG alone with SIMBAD corroborating; HD 40 bound by AT-HYG alone
 *  and contradicted; Gl 165A with a HIP the HIP walk binds. */
const spine: SpineRow[] = [
  spineRow({ proper: 'Sol' }),
  spineRow({ tyc: '1-1-1', hip: '10', hd: '100001', gaia_source_id: '111' }),
  spineRow({ tyc: '1-2-1', hd: '5', gaia_source_id: '222' }),
  spineRow({ tyc: '9-8-1', hd: '40', gaia_source_id: '888' }),
  spineRow({ tyc: '7-7-1', hip: '20', gl: 'Gl 165A', gaia_source_id: '333' }),
];

/** Primaries admitting, beyond the spine: TYC 2-1-1 (HD 60, below the link
 *  floor, with HIP 30 through Tycho-2's own column); TYC 2-2-1 (HD 200500);
 *  TYC 2-3-1 carrying only HD 100001, a spine record's; TYC 2-4-1 (HD 61)
 *  whose walk binds the spine record's own source; TYC 2-5-1 (HD 62) whose
 *  source the gate refused; HIP 40 alone; CNS5's GJ 10001. */
const tables: PrimaryTables = {
  iv25: [
    { tyc: '1-1-1', hd: 100001, nHd: 1, nTyc: 1 },
    { tyc: '1-2-1', hd: 5, nHd: 1, nTyc: 1 },
    { tyc: '9-8-1', hd: 40, nHd: 1, nTyc: 1 },
    { tyc: '2-1-1', hd: 60, nHd: 1, nTyc: 1 },
    { tyc: '2-2-1', hd: 200500, nHd: 1, nTyc: 1 },
    { tyc: '2-3-1', hd: 100001, nHd: 1, nTyc: 2 },
    { tyc: '2-4-1', hd: 61, nHd: 1, nTyc: 1 },
    { tyc: '2-5-1', hd: 62, nHd: 1, nTyc: 1 },
  ],
  v50: [
    { hr: 1, hd: 100001, name: null },
    { hr: 2, hd: 60, name: null },
  ],
  iv27a: [
    { hd: 100001, hip: 10, bayer: 'alf', flamsteed: 1, cst: 'And' },
    { hd: 60, hip: null, bayer: null, flamsteed: 7, cst: 'Cas' },
  ],
  cns5: [
    { cns5: 1, gj: '165', gjComp: 'AB', gaiaSourceId: null, hip: 20, astrometry: null },
    { cns5: 2, gj: '10001', gjComp: null, gaiaSourceId: '555', hip: null, astrometry: null },
    { cns5: 0, gj: 'Sun', gjComp: null, gaiaSourceId: null, hip: null, astrometry: null },
  ],
  gliese: parseGlieseTsv(GLIESE_TSV),
  hipI239: new Set([10, 20, 30, 40]),
  hip2: new Set<number>(),
  tycho2HipByTyc: new Map([['1-1-1', 10], ['2-1-1', 30]]),
  wgsn: {
    names: new Set<string>(),
    hd: new Set<number>(),
    hip: new Set<number>(),
    flamByHd: new Map<number, Set<number>>(),
    flamByHip: new Map<number, Set<number>>(),
  },
  tycho2: new Map([
    ['1-1-1', tycho2(8.5)], ['1-2-1', tycho2(10.2)], ['2-1-1', tycho2(9.1)],
    ['2-2-1', tycho2(9.9)], ['2-3-1', tycho2(11)], ['2-4-1', tycho2(11)], ['2-5-1', tycho2(11)],
  ]),
  tycToSource: new Map([
    ['1-1-1', '111'], ['2-1-1', '444'], ['2-2-1', '666'], ['2-4-1', '111'], ['2-5-1', '777'],
  ]),
  hipToSource: new Map([[10, '111'], [20, '333'], [30, '444'], [40, '999']]),
  simbadBySourceId: new Map([
    ['222', { hip: null, tyc: '1-2-1', gj: null }],
    ['888', { hip: null, tyc: '9-9-9', gj: null }],
  ]),
};

const overlay: ClassicIdOverlay = new Map([
  ['111', entry({ hd: [100001], hr: [1], hip: [10], flamsteed: ['1 And'] })],
  ['444', entry({ hd: [60], hr: [2], hip: [30] })],
  ['666', entry({ hd: [200500] })],
  ['555', entry({ gj: ['10001'] })],
  ['999', entry({ hip: [40] })],
  ['333', entry({ hip: [20], gj: ['165AB'] })],
]);

const result = buildMembership({
  spine, tables, overlay, overrides: new Map(), siblingRenderedSourceIds: new Set(),
});
const byTyc = new Map(result.rows.map((r) => [r.tyc, r]));

describe('buildMembership — the spine side', () => {
  it('keeps every spine row and classifies its binding', () => {
    expect(result.counts.spineRows).toBe(5);
    expect(byTyc.get('1-1-1')?.binding).toBe('crosswalk_gated');
    expect(byTyc.get('1-2-1')?.binding).toBe('simbad_corroborated');
    expect(byTyc.get('1-2-1')?.gaia_source_id).toBe('222');
  });

  it('drops an uncorroborated binding into the review queue with the SIMBAD witness', () => {
    const row = byTyc.get('9-8-1')!;
    expect(row.gaia_source_id).toBe('');
    expect(row.binding).toBe('none');
    expect(result.bindingReview).toEqual([expect.objectContaining({
      tyc: '9-8-1', hd: '40', gaia_source_id: '888', verdict: 'unreachable',
      simbad: 'contradicts', simbad_tyc: '9-9-9',
    })]);
    expect(result.counts.bindingReviewRows).toBe(1);
  });

  it('carries the label merge onto the row and attests the merged cells', () => {
    const row = byTyc.get('1-1-1')!;
    expect(row.hr).toBe('1');
    expect(row.flam).toBe('1');
    expect(row.routes).toBe('hd:iv25|hr:v50|hip:i239|flam:iv27a|tyc:tycho2');
    expect(result.flips.map((f) => `${f.field}:${f.applied}:${f.disposition}`).sort())
      .toEqual(['flam:1:added', 'hr:1:added']);
  });

  it('puts Sol first, on its proper name alone', () => {
    expect(result.rows[0]).toMatchObject({ proper: 'Sol', binding: 'none', routes: 'proper:sol' });
    expect(manifestDesignations(result.rows[0])).toEqual(['sol:sun']);
  });
});

describe('buildMembership — the additions', () => {
  it('admits an IV/25 star and merges the HIP Tycho-2 names for it into one row', () => {
    const row = byTyc.get('2-1-1')!;
    expect(row).toMatchObject({
      hip: '30', hd: '60', hr: '2', flam: '7', gaia_source_id: '444', binding: 'crosswalk_gated',
    });
    expect(row.routes).toBe('hd:iv25|hr:v50|hip:i239|flam:iv27a|tyc:tycho2');
    expect(result.rows.filter((r) => r.hip === '30')).toHaveLength(1);
  });

  it('ledgers each admitted row under the § 6.1 reason its designation earns', () => {
    const reasons = new Map(result.ledger.map((l) => [manifestKey(l), l.reason]));
    expect(reasons.get(manifestKey(byTyc.get('2-1-1')!))).toBe('admitted:hd_link_gap');
    expect(reasons.get(manifestKey(byTyc.get('2-2-1')!))).toBe('admitted:hd_omitted');
    const hip40 = result.rows.find((r) => r.hip === '40')!;
    expect(reasons.get(manifestKey(hip40))).toBe('admitted:hip_omitted');
    const gj = result.rows.find((r) => r.gl === 'GJ 10001')!;
    expect(reasons.get(manifestKey(gj))).toBe('admitted:cns5_census');
    expect(gj.gaia_source_id).toBe('555');
    expect(result.counts.additionsByReason).toEqual({
      'admitted:hd_link_gap': 3, 'admitted:hd_omitted': 1,
      'admitted:hip_omitted': 1, 'admitted:cns5_census': 1,
    });
    for (const l of result.ledger) {
      expect(
        (ADDITION_REASONS as readonly string[]).includes(l.reason)
          || l.reason.startsWith(COMPONENT_REASON_PREFIX),
      ).toBe(true);
    }
  });

  it('resolves a TYC carrying only a spine record\'s HD onto that record, not into a row', () => {
    expect(byTyc.has('2-3-1')).toBe(false);
    expect(result.ledger).toContainEqual({
      tyc: '2-3-1', hip: '', hd: '100001', gl: '', gaia_source_id: '', reason: 'component:hd:100001',
    });
    expect(result.counts.componentRows).toBe(1);
  });

  it('leaves the source empty where the walk binds a spine record\'s own source', () => {
    expect(byTyc.get('2-4-1')).toMatchObject({ hd: '61', gaia_source_id: '', binding: 'none' });
    expect(result.counts.additionSourceOnSpine).toBe(1);
  });

  it('leaves the source empty where the gate refused the binding', () => {
    expect(byTyc.get('2-5-1')).toMatchObject({ hd: '62', gaia_source_id: '' });
    expect(result.counts.additionSourceGateRefused).toBe(1);
  });

  it('carries no duplicate source_id and keys every row on a designation', () => {
    const ids = result.rows.map((r) => r.gaia_source_id).filter((s) => s !== '');
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of result.rows) expect(manifestDesignations(row).length).toBeGreaterThan(0);
    expect(result.counts.rows).toBe(11);
  });
});

describe('codecs', () => {
  it('round-trips the manifest and the ledger', () => {
    expect(parseManifestTsv(serializeManifest(result.rows))).toEqual(result.rows);
    const ledger = parseLedgerTsv(serializeLedger(result.ledger));
    expect(ledger).toHaveLength(result.ledger.length);
    expect(new Set(ledger.map(manifestKey))).toEqual(new Set(result.ledger.map(manifestKey)));
  });

  it('refuses a manifest whose header is not the column list byte for byte', () => {
    expect(() => parseManifestTsv('hip\ttyc\n')).toThrow(/header mismatch/);
  });

  it('is deterministic across a re-run', () => {
    const again = buildMembership({
      spine, tables, overlay, overrides: new Map(), siblingRenderedSourceIds: new Set(),
    });
    expect(serializeManifest(again.rows)).toBe(serializeManifest(result.rows));
    expect(serializeLedger(again.ledger)).toBe(serializeLedger(result.ledger));
  });
});

describe('matchSpineToManifest', () => {
  // Rows 2 and 7 are a mutual HD swap: the merge moved HD 6 off the HIP 12
  // record onto its sibling and HD 7 the other way, as the overlay does for
  // resolved pairs whose components AT-HYG had crossed.
  const manifest = [
    manifestRow({ proper: 'Sol' }),
    manifestRow({ hip: '10', hd: '100001', gaia_source_id: '111' }),
    manifestRow({ hip: '12', hd: '7', gaia_source_id: '222' }),
    manifestRow({ gl: 'GJ 9140', gaia_source_id: '333' }),
    manifestRow({ hd: '50', gaia_source_id: '444' }),
    manifestRow({ hd: '50', gaia_source_id: '555' }),
    manifestRow({ hd: '70' }),
    manifestRow({ hip: '13', hd: '6', gaia_source_id: '777' }),
  ];
  const designations = [
    spineRow({ proper: 'Sol' }),
    spineRow({ hip: '10', hd: '100001', gaia_source_id: '111' }),
    spineRow({ hip: '12', hd: '6', gaia_source_id: '222' }),
    spineRow({ gl: 'Gl 157.1', gaia_source_id: '333' }),
    spineRow({ hd: '50' }),
    spineRow({ hd: '999' }),
    spineRow({ hip: '13', hd: '7', gaia_source_id: '777' }),
  ].map(spineDesignations);
  const match = matchSpineToManifest(designations, manifest, [
    { a: 'gl:Gl_157.1', b: 'gl:GJ_9140' },
  ]);

  it('keys each spine row on its canonical designation, through a bridge where one is stored', () => {
    expect(match.manifestIndex.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('resolves both sides of a mutual swap to their own rows', () => {
    expect(match.manifestIndex[6]).toBe(7);
  });

  it('drops a designation two manifest rows carry, so it keys through nothing', () => {
    expect(match.unmatched).toEqual([4, 5]);
    expect(match.multiple).toEqual([]);
  });

  it('reports the manifest rows no spine row reaches', () => {
    expect(match.unreached).toEqual([4, 5, 6]);
  });
});
