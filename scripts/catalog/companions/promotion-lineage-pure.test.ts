import { describe, expect, it } from 'vitest';

import { compareLineageRows, paramsOf, stageLineageText } from '../lineage/lineage-row-pure';
import { makeStar } from '../parse/star-fixture';
import type { PromotedRow, RowOutcome } from './companion-promotion';
import { multiplesRow } from './multiples-fixture';
import {
  PROMOTION_CODES, promotionIdentityRows, promotionLineageRow, promotionOriginKey,
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
      'promotion.primary-unresolved',
      'promotion.not-applicable',
    ]);
    expect(() => stageLineageText(PROMOTION_CODES, [...rows].sort(compareLineageRows))).not.toThrow();
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

describe('promotionIdentityRows', () => {
  it('writes one identity row per minted record, and none for any other outcome', () => {
    const stars = [
      makeStar(),
      makeStar({
        originKey: 'multiples:22266-1645-AB/B', hip: null, gaiaSourceId: '2595463996992115840',
        syntheticId: 'synth-22266-1645-B',
      }),
    ];
    const identity = promotionIdentityRows([
      promoted({ kind: 'minted', idx: 1, synthetic: false, brightness: own, constellationSplit: false }),
      promoted({ kind: 'adopted', idx: 0, via: 'earlier-mint' }),
    ], stars);
    expect(identity).toEqual([{
      key: 'multiples:22266-1645-AB/B', tyc: '', hip: '', hd: '', gl: '',
      gaia_source_id: '2595463996992115840',
      designations: ['synth:22266-1645-B', 'gaia_dr3:2595463996992115840'],
    }]);
  });
});
