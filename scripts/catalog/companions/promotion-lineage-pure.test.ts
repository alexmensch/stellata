import { describe, expect, it } from 'vitest';

import { paramsOf, sortLineageLines, stageLineageLine, stageLineageText } from '../lineage/lineage-row-pure';
import { makeStar } from '../parse/star-fixture';
import type { PromotedRow, RowOutcome } from './companion-promotion';
import { multiplesRow } from './multiples-fixture';
import {
  PROMOTION_CODES, promotionLineage, promotionLineageRow, promotionOriginKey,
} from './promotion-lineage-pure';

const row = multiplesRow({ systemId: '22266-1645-AB', comp: 'B' });
const promoted = (outcome: RowOutcome, anchors: Partial<PromotedRow> = {}): PromotedRow => (
  { row, via: 'secondary', outcome, anchor: 'spine:7', systemAnchor: 'spine:7', ...anchors }
);
const recordKey = (idx: number): string => `spine:${idx}`;
const own = { source: 'own', spectMsFromOwnAbsmag: false } as const;

describe('promotionLineageRow', () => {
  it('keys the row on its multiples.tsv row', () => {
    expect(promotionOriginKey(row)).toBe('multiples:22266-1645-AB/B');
    expect(promotionLineageRow(promoted({ kind: 'not-applicable' }), recordKey).key)
      .toBe('multiples:22266-1645-AB/B');
  });

  it('maps every variant to a code the writer accepts', () => {
    const outcomes: RowOutcome[] = [
      { kind: 'dropped', reason: 'compound-comp' },
      { kind: 'dropped', reason: 'parked-record', parked: 'spine:2', viaGaia5p: true, ownedFit: false },
      { kind: 'adopted', idx: 3, via: 'earlier-mint' },
      { kind: 'adopted', idx: 4, via: 'own-hip', desigConFromAnchor: true, recurated: null },
      { kind: 'minted', idx: 5, synthetic: true, brightness: own, constellationSplit: false },
      { kind: 'repositioned', idx: 6, brightness: own },
      { kind: 'primary-unresolved' },
      { kind: 'unpaired' },
      { kind: 'not-applicable' },
    ];
    const rows = outcomes.map((o) => promotionLineageRow(promoted(o), recordKey));
    expect(rows.map((r) => r.code)).toEqual([
      'promotion.dropped.compound-comp',
      'promotion.dropped.parked-record',
      'promotion.adopted.earlier-mint',
      'promotion.adopted.own-hip',
      'promotion.minted',
      'promotion.repositioned',
      'promotion.parked.primary-unresolved',
      'promotion.parked.unpaired',
      'promotion.not-applicable.pair-anchor',
    ]);
    const lines = sortLineageLines(rows.map((r) => stageLineageLine(PROMOTION_CODES, r)));
    expect(() => stageLineageText(PROMOTION_CODES, lines)).not.toThrow();
  });

  it('names an adopted record by its origin key and the re-curation it took', () => {
    const r = promotionLineageRow(promoted({
      kind: 'adopted', idx: 4, via: 'own-id', desigConFromAnchor: false,
      recurated: 'wds_mag',
    }), recordKey);
    expect(paramsOf(r)).toEqual({
      via: 'secondary', record: 'spine:4', desig_con_from_anchor: 'false', recurated: 'wds_mag',
    });
  });

  it('names the record a merge-effect drop merges into', () => {
    const r = promotionLineageRow(promoted({ kind: 'dropped', reason: 'anchor-is-component', idx: 7 }), recordKey);
    expect(r.code).toBe('promotion.dropped.anchor-is-component');
    expect(paramsOf(r)).toEqual({ via: 'secondary', record: 'spine:7' });
  });

  it('cites the parked record whose refused parallax the row would re-serve', () => {
    const r = promotionLineageRow(promoted({
      kind: 'dropped', reason: 'parked-record', parked: 'spine:2', viaGaia5p: false, ownedFit: false,
    }), recordKey);
    expect(r.evidence).toEqual(['spine:7', 'spine:2']);
  });

  it('cites the anchor and a distinct system anchor, never the row itself', () => {
    const cite = (anchors: Partial<PromotedRow>): readonly string[] => promotionLineageRow(
      promoted({ kind: 'not-applicable' }, anchors), recordKey,
    ).evidence;
    expect(cite({})).toEqual(['spine:7']);
    expect(cite({ anchor: 'gaia-dr3:9', systemAnchor: 'spine:7' })).toEqual(['gaia-dr3:9', 'spine:7']);
    expect(cite({ anchor: null, systemAnchor: null })).toEqual([]);
    expect(cite({ anchor: 'multiples:22266-1645-AB/B' })).toEqual(['spine:7']);
  });
});

describe('promotionLineage identity', () => {
  const stars = [
    makeStar(),
    makeStar({
      originKey: 'multiples:22266-1645-AB/B', hip: null, gaiaSourceId: '2595463996992115840',
      syntheticId: 'synth-22266-1645-B',
    }),
  ];

  it('writes one identity row per minted record, and none for a merge or no-effect outcome', () => {
    const { identity } = promotionLineage([
      promoted({ kind: 'minted', idx: 1, synthetic: false, brightness: own, constellationSplit: false }),
      promoted({ kind: 'adopted', idx: 0, via: 'earlier-mint' }),
      promoted({ kind: 'not-applicable' }),
    ], stars, new Set());
    expect(identity).toEqual([{
      key: 'multiples:22266-1645-AB/B', tyc: '', hip: '', hd: '', gl: '',
      gaia_source_id: '2595463996992115840',
      designations: ['synth:22266-1645-B', 'gaia_dr3:2595463996992115840'],
    }]);
  });

  it('keys a parked or retired row on the identifier cells it arrived with, and skips one with none', () => {
    const standalone = multiplesRow({ systemId: '19082+3829-_C', comp: 'C', hip: 42, gaiaSourceId: '2099222754064121216' });
    const { identity } = promotionLineage([
      { row: standalone, via: 'unpaired', outcome: { kind: 'unpaired' }, anchor: null, systemAnchor: null },
      promoted({ kind: 'dropped', reason: 'no-absmag' }),
    ], stars, new Set());
    expect(identity).toEqual([
      {
        key: 'multiples:19082+3829-_C/C', tyc: '', hip: '42', hd: '', gl: '',
        gaia_source_id: '2099222754064121216', designations: ['hip:42', 'gaia_dr3:2099222754064121216'],
      },
    ]);
  });

  it('keys a removed row on no designation membership or a mint of this stage already founds', () => {
    const unpaired = (comp: string, cells: { hip?: number; gaiaSourceId?: string }): PromotedRow => ({
      row: multiplesRow({ systemId: '21050+1243-_X', comp, ...cells }),
      via: 'unpaired', outcome: { kind: 'unpaired' }, anchor: null, systemAnchor: null,
    });
    const { identity } = promotionLineage([
      promoted({ kind: 'minted', idx: 1, synthetic: false, brightness: own, constellationSplit: false }),
      unpaired('A', { hip: 104066 }),
      unpaired('B', { gaiaSourceId: '2595463996992115840' }),
      unpaired('C', { hip: 104066, gaiaSourceId: '77' }),
    ], stars, new Set(['hip:104066']));
    expect(identity.map((r) => [r.key, r.hip, r.gaia_source_id, r.designations])).toEqual([
      ['multiples:22266-1645-AB/B', '', '2595463996992115840', ['synth:22266-1645-B', 'gaia_dr3:2595463996992115840']],
      ['multiples:21050+1243-_X/C', '', '77', ['gaia_dr3:77']],
    ]);
  });
});
