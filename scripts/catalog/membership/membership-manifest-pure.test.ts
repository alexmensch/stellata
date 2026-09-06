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
  parseBindingDispositionsTsv,
  parseLabelDropsTsv,
  parseLedgerTsv,
  parseManifestTsv,
  serializeLabelDrops,
  serializeLedger,
  serializeManifest,
  type BindingDispositionRow,
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

function tycho2(vtMag: number, hip: number | null = null): Tycho2Row {
  return {
    raDeg: 0, decDeg: 0, epoch: 2000, pmRaMasyr: null, pmDecMasyr: null,
    btMag: null, vtMag, fromIcrs: false, isPhotocentre: false, hip,
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
 *  and contradicted; Gl 165A with a HIP the HIP walk binds; HIP 70 carrying an
 *  HD and a Flamsteed number no primary publishes. */
const spine: SpineRow[] = [
  spineRow({ proper: 'Sol' }),
  spineRow({ tyc: '1-1-1', hip: '10', hd: '100001', gaia_source_id: '111' }),
  spineRow({ tyc: '1-2-1', hd: '5', gaia_source_id: '222' }),
  spineRow({ tyc: '9-8-1', hd: '40', gaia_source_id: '888' }),
  spineRow({ tyc: '7-7-1', hip: '20', gl: 'Gl 165A', gaia_source_id: '333' }),
  spineRow({ hip: '70', hd: '70000', flam: '5' }),
];

/** Primaries admitting, beyond the spine: TYC 2-1-1 (HD 60, below the link
 *  floor, with HIP 30 through Tycho-2's own column); TYC 2-2-1 (HD 200500);
 *  TYC 2-3-1 carrying only HD 100001, a spine record's; TYC 2-4-1 (HD 61)
 *  whose walk binds the spine record's own source; TYC 2-5-1 (HD 62) whose
 *  source the gate refused; HIP 40 alone; CNS5's GJ 10001. Two IV/25 pairs
 *  resolve one HD onto two Tycho-2 stars with no spine record to lose it to:
 *  HD 60 again on TYC 2-6-1, and HD 70 on TYC 2-7-1 (unbound) + 2-8-1.
 *  TYC 3-1-1 / 3-2-1 reach one raw source between them; TYC 3-3-1's TYC and
 *  HIP routes bind different ones; CNS5 numbers GJ 10002 on two census rows;
 *  TYC 3-4-1 carries HD 83 alongside HD 5, which a spine record holds. */
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
    { tyc: '2-6-1', hd: 60, nHd: 1, nTyc: 2 },
    { tyc: '2-7-1', hd: 70, nHd: 1, nTyc: 2 },
    { tyc: '2-8-1', hd: 70, nHd: 1, nTyc: 2 },
    { tyc: '3-1-1', hd: 80, nHd: 1, nTyc: 1 },
    { tyc: '3-2-1', hd: 81, nHd: 1, nTyc: 1 },
    { tyc: '3-3-1', hd: 82, nHd: 1, nTyc: 1 },
    { tyc: '3-4-1', hd: 83, nHd: 2, nTyc: 1 },
    { tyc: '3-4-1', hd: 5, nHd: 2, nTyc: 1 },
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
    { cns5: 3, gj: '10002', gjComp: null, gaiaSourceId: null, hip: null, astrometry: null },
    { cns5: 4, gj: '10002', gjComp: null, gaiaSourceId: null, hip: null, astrometry: null },
    { cns5: 0, gj: 'Sun', gjComp: null, gaiaSourceId: null, hip: null, astrometry: null },
  ],
  gliese: parseGlieseTsv(GLIESE_TSV),
  hipI239: new Set([10, 20, 30, 40, 50, 70]),
  hdI239: new Set<number>(),
  glAliases: new Map<string, string[]>(),
  hip2: new Set<number>(),
  wgsn: {
    names: new Set<string>(),
    hd: new Set<number>(),
    hip: new Set<number>(),
    flamByHd: new Map<number, Set<number>>(),
    flamByHip: new Map<number, Set<number>>(),
  },
  tycho2: new Map([
    ['1-1-1', tycho2(8.5, 10)], ['1-2-1', tycho2(10.2)], ['2-1-1', tycho2(9.1, 30)],
    ['2-2-1', tycho2(9.9)], ['2-3-1', tycho2(11)], ['2-4-1', tycho2(11)], ['2-5-1', tycho2(11)],
    ['2-6-1', tycho2(11)], ['2-7-1', tycho2(11)], ['2-8-1', tycho2(11)],
    ['3-1-1', tycho2(11)], ['3-2-1', tycho2(11)], ['3-3-1', tycho2(11, 50)],
    ['3-4-1', tycho2(11)],
  ]),
  tycToSource: new Map([
    ['1-1-1', '111'], ['2-1-1', '444'], ['2-2-1', '666'], ['2-4-1', '111'], ['2-5-1', '777'],
    ['2-8-1', '1010'], ['3-1-1', '1212'], ['3-2-1', '1212'], ['3-3-1', '1313'],
  ]),
  hipToSource: new Map([[10, '111'], [20, '333'], [30, '444'], [40, '999'], [50, '1414']]),
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
  ['1010', entry({ hd: [70] })],
  ['1212', entry({ hd: [80, 81] })],
  ['1313', entry({ hd: [82] })],
]);

const input = {
  spine, tables, overlay, overrides: new Map(), siblingRenderedSourceIds: new Set<string>(),
  dispositions: new Map<string, BindingDispositionRow>(),
};
const result = buildMembership(input);
const byTyc = new Map(result.rows.map((r) => [r.tyc, r]));

describe('buildMembership — the spine side', () => {
  it('keeps every spine row and classifies its binding', () => {
    expect(result.counts.spineRows).toBe(6);
    expect(byTyc.get('1-1-1')?.binding).toBe('crosswalk_gated');
    expect(byTyc.get('1-2-1')?.binding).toBe('simbad_corroborated');
    expect(byTyc.get('1-2-1')?.gaia_source_id).toBe('222');
  });

  it('keeps a reviewed binding on a committed keep disposition, queue row intact', () => {
    const disposed = buildMembership({
      ...input,
      dispositions: new Map([['888', {
        gaia_source_id: '888', disposition: 'keep', basis: 'tycho2_position', evidence: '0.1"',
      }]]),
    });
    const row = disposed.rows.find((r) => r.tyc === '9-8-1')!;
    expect(row).toMatchObject({ gaia_source_id: '888', binding: 'reviewed' });
    expect(disposed.bindingReview).toHaveLength(1);
    expect(disposed.counts.bindingByClass.reviewed).toBe(1);
  });

  // The committed file is all `keep` today, so nothing else exercises the other
  // half of the enum — and gate (iii) re-adds exactly the bindings a drop takes
  // out of the manifest.
  it('strips a binding its disposition drops', () => {
    const disposed = buildMembership({
      ...input,
      dispositions: new Map([['888', {
        gaia_source_id: '888', disposition: 'drop', basis: 'tycho2_position', evidence: '4.1"',
      }]]),
    });
    expect(disposed.rows.find((r) => r.tyc === '9-8-1'))
      .toMatchObject({ gaia_source_id: '', binding: 'none' });
    expect(disposed.bindingReview).toHaveLength(1);
    expect(disposed.counts.bindingByClass.reviewed).toBe(0);
  });

  // The display cell is not privileged: when it is the cell no primary
  // attests, the first alias that survives takes its place rather than the
  // record shipping HD-less beside an HD a primary does publish.
  it('promotes a surviving hd alias into the display cell', () => {
    const promoted = buildMembership({
      ...input,
      spine: [...spine, spineRow({ tyc: '5-5-1', hd: '70002', gaia_source_id: '1515' })],
      tables: { ...tables, hdI239: new Set([70003]) },
      overlay: new Map([...overlay, ['1515', entry({ hd: [70002, 70003] })]]),
    });
    expect(promoted.rows.find((r) => r.tyc === '5-5-1')).toMatchObject({ hd: '70003' });
    expect(promoted.labelDrops).toContainEqual(expect.objectContaining({
      cell: 'hd', value: '70002', reason: 'hd_unattested',
    }));
  });

  it('drops the spine labels no primary attests onto the label ledger', () => {
    const row = result.rows.find((r) => r.hip === '70')!;
    expect(row).toMatchObject({ hd: '', flam: '', routes: 'hip:i239' });
    expect(result.labelDrops).toEqual([
      { tyc: '', hip: '70', hd: '', gl: '', gaia_source_id: '', cell: 'hd', value: '70000', reason: 'hd_unattested' },
      { tyc: '', hip: '70', hd: '', gl: '', gaia_source_id: '', cell: 'flam', value: '5', reason: 'flamsteed_unattested' },
    ]);
    expect(result.counts.labelDropsByReason).toEqual({ flamsteed_unattested: 1, hd_unattested: 1 });
    expect(result.counts.unattestedByCell.hd).toBe(0);
    expect(result.counts.unattestedByCell.flam).toBe(0);
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
      'admitted:hd_link_gap': 8, 'admitted:hd_omitted': 1,
      'admitted:hip_omitted': 1, 'admitted:cns5_census': 2,
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
    expect(result.counts.componentRows).toBe(4);
  });

  // IV/25 resolving one HD onto two Tycho-2 stars, neither on the spine: the
  // second is a component of the first, never a second record answering to the
  // same designation — which would key no SID for either (docs/sid.md § 4.1).
  it('admits one record per designation when two groups arrive with the same HD', () => {
    expect(byTyc.has('2-6-1')).toBe(false);
    expect(result.ledger).toContainEqual({
      tyc: '2-6-1', hip: '', hd: '60', gl: '', gaia_source_id: '', reason: 'component:hd:60',
    });
    expect(byTyc.get('2-1-1')?.hd).toBe('60');
    expect(result.counts.sharedDesignations).toBe(0);
  });

  // The contested designation goes to the component a gated walk bound, not to
  // the lower TYC: the other would park for want of the parallax this one has.
  it('gives a contested designation to the group whose binding survives', () => {
    expect(byTyc.get('2-8-1')).toMatchObject({ hd: '70', gaia_source_id: '1010' });
    expect(byTyc.has('2-7-1')).toBe(false);
    expect(result.ledger).toContainEqual({
      tyc: '2-7-1', hip: '', hd: '70', gl: '', gaia_source_id: '', reason: 'component:hd:70',
    });
  });

  it('leaves the source empty where the walk binds a spine record\'s own source', () => {
    expect(byTyc.get('2-4-1')).toMatchObject({ hd: '61', gaia_source_id: '', binding: 'none' });
    expect(result.counts.additionSourceOnSpine).toBe(1);
  });

  it('leaves the source empty where the gate refused the binding', () => {
    expect(byTyc.get('2-5-1')).toMatchObject({ hd: '62', gaia_source_id: '' });
    expect(result.counts.additionSourceGateRefused).toBe(1);
  });

  // Two census rows under one GJ number are one star, and the second resolves
  // onto the first — the anchor naming that record's own cell. A component
  // letter is a different star and keeps its own record (GJ 3131B is not
  // GJ 3131A), so the guard is keyed on the normalised GJ, letter included.
  it('resolves a second census row under one GJ onto the first', () => {
    expect(result.rows.filter((r) => r.gl === 'GJ 10002')).toHaveLength(1);
    expect(result.ledger).toContainEqual({
      tyc: '', hip: '', hd: '', gl: 'GJ 10002', gaia_source_id: '',
      reason: 'component:gl:GJ_10002',
    });
  });

  it('leaves a source no group takes where two groups reach it', () => {
    expect(byTyc.get('3-1-1')).toMatchObject({ hd: '80', gaia_source_id: '' });
    expect(byTyc.get('3-2-1')).toMatchObject({ hd: '81', gaia_source_id: '' });
    expect(result.counts.additionSourceShared).toBe(1);
  });

  // § 4 gives the HD route label authority; the source follows it too.
  it("takes the TYC route's source where the HIP route binds another", () => {
    expect(byTyc.get('3-3-1')).toMatchObject({ hip: '50', gaia_source_id: '1313' });
    expect(result.counts.additionRouteSourceDisagree).toBe(1);
  });

  // Admitted, but one designation short: HD 5 is a spine record's, so the
  // record ships without a number the primaries publish for it.
  it('counts an admitted row the guard withheld a designation from', () => {
    expect(byTyc.get('3-4-1')).toMatchObject({ hd: '83', hd_alt: '' });
    expect(result.counts.additionsWithBlockedDesignation).toBe(1);
  });

  it('carries no duplicate source_id and keys every row on a classical designation', () => {
    const ids = result.rows.map((r) => r.gaia_source_id).filter((s) => s !== '');
    expect(new Set(ids).size).toBe(ids.length);
    // Never the Gaia id alone: a group with no classical designation left is
    // ledgered, not admitted, so `sid:allocate` keys every mint hd / hip / gl.
    for (const row of result.rows) {
      expect(manifestDesignations(row).filter((d) => !d.startsWith('gaia_dr3:')).length)
        .toBeGreaterThan(0);
    }
    expect(result.counts.additionGaiaKeyedOnly).toBe(0);
    expect(result.counts.rows).toBe(18);
  });
});

// § 6.1 forbids a silent drop, and admission reads one item per cohort: a
// group holding two would leave a primary's row in no manifest row and on no
// ledger line. Two IV/25 TYCs naming one HIP is the shape that gets there.
describe('a group holding two items of one cohort', () => {
  it('refuses to build rather than admit the first and drop the rest', () => {
    const twoTycsOneHip: PrimaryTables = {
      ...tables,
      iv25: [...tables.iv25, { tyc: '4-1-1', hd: 90, nHd: 1, nTyc: 2 },
        { tyc: '4-2-1', hd: 91, nHd: 1, nTyc: 2 }],
      hipI239: new Set([...tables.hipI239, 60]),
      tycho2: new Map([...tables.tycho2,
        ['4-1-1', tycho2(11, 60)], ['4-2-1', tycho2(11, 60)]]),
    };
    expect(() => buildMembership({ ...input, tables: twoTycsOneHip }))
      .toThrow(/2 hd items \(tyc:4-1-1, tyc:4-2-1\)/);
  });
});

describe('codecs', () => {
  it('round-trips the manifest, the ledger and the label drops', () => {
    expect(parseManifestTsv(serializeManifest(result.rows))).toEqual(result.rows);
    const ledger = parseLedgerTsv(serializeLedger(result.ledger));
    expect(ledger).toHaveLength(result.ledger.length);
    expect(new Set(ledger.map(manifestKey))).toEqual(new Set(result.ledger.map(manifestKey)));
    const drops = parseLabelDropsTsv(serializeLabelDrops(result.labelDrops));
    expect(new Set(drops.map((d) => JSON.stringify(d))))
      .toEqual(new Set(result.labelDrops.map((d) => JSON.stringify(d))));
  });

  it('refuses a manifest whose header is not the column list byte for byte', () => {
    expect(() => parseManifestTsv('hip\ttyc\n')).toThrow(/header mismatch/);
  });

  // One reader behind all four codecs, so a short row throws wherever it lands
  // rather than parsing into blanks the ledger's key columns cannot tell from
  // a genuinely empty cell.
  it('refuses a row that does not carry every column', () => {
    const ledger = `${['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'].join('\t')}\n`;
    expect(() => parseLedgerTsv(`${ledger}1-1-1\t\t\n`)).toThrow(/3 cells, expected 6/);
    const drops = `${['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'cell', 'value', 'reason'].join('\t')}\n`;
    expect(() => parseLabelDropsTsv(`${drops}1-1-1\t\t\n`)).toThrow(/3 cells, expected 8/);
  });

  it('parses dispositions under the closed enums, refusing an unstated basis or evidence', () => {
    const header = 'gaia_source_id\tdisposition\tbasis\tevidence\n';
    const parsed = parseBindingDispositionsTsv(`${header}888\tkeep\ttycho2_position\tsep 0.1"\n`);
    expect(parsed.get('888')).toEqual({
      gaia_source_id: '888', disposition: 'keep', basis: 'tycho2_position', evidence: 'sep 0.1"',
    });
    expect(() => parseBindingDispositionsTsv(`${header}888\tkeep\tguesswork\tx\n`)).toThrow(/basis/);
    expect(() => parseBindingDispositionsTsv(`${header}888\tmaybe\ttycho2_position\tx\n`)).toThrow(/disposition/);
    expect(() => parseBindingDispositionsTsv(`${header}888\tkeep\ttycho2_position\t\n`)).toThrow(/evidence/);
    expect(() => parseBindingDispositionsTsv(`${header}888\tkeep\ttycho2_position\tx\n888\tdrop\ttycho2_position\ty\n`))
      .toThrow(/duplicate/);
  });

  it('is deterministic across a re-run', () => {
    const again = buildMembership(input);
    expect(serializeManifest(again.rows)).toBe(serializeManifest(result.rows));
    expect(serializeLedger(again.ledger)).toBe(serializeLedger(result.ledger));
    expect(serializeLabelDrops(again.labelDrops)).toBe(serializeLabelDrops(result.labelDrops));
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
