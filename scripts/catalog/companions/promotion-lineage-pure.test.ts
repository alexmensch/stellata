import { describe, expect, it } from 'vitest';

import { foldStageLines, paramsOf, sortLineageLines, stageLineageLine, stageLineageText } from '../lineage/lineage-row-pure';
import { SEEDED_BRANCH, seededCodeCheck } from '../lineage/count-block-fixture';
import { makeStar } from '../parse/star-fixture';
import type { PromotedRow, PromotionDerivedCounts, RowOutcome } from './companion-promotion';
import { multiplesRow } from './multiples-fixture';
import {
  PROMOTION_CODES, promotionLineage, promotionLineageRows, promotionOriginKey, promotionSummary,
} from './promotion-lineage-pure';

const row = multiplesRow({ systemId: '22266-1645-AB', comp: 'B' });
const promoted = (outcome: RowOutcome, anchors: Partial<PromotedRow> = {}): PromotedRow => (
  { row, via: 'secondary', outcome, anchor: 'spine:7', systemAnchor: 'spine:7', synthKey: 'synth-22266-1645-B', ...anchors }
);
const recordKey = (idx: number): string => `spine:${idx}`;
const own = { source: 'own', spectMsFromOwnAbsmag: false } as const;
const rowsOf = (outcome: RowOutcome, anchors: Partial<PromotedRow> = {}) => promotionLineageRows(promoted(outcome, anchors), recordKey);
const outcomeRow = (outcome: RowOutcome, anchors: Partial<PromotedRow> = {}) => rowsOf(outcome, anchors)[0];

const OUTCOMES: RowOutcome[] = [
  { kind: 'dropped', reason: 'compound-comp' },
  { kind: 'dropped', reason: 'parked-record', parked: 'spine:2', viaGaia5p: true, ownedFit: true },
  { kind: 'dropped', reason: 'parked-record', parked: 'spine:2', viaGaia5p: false, ownedFit: false },
  { kind: 'adopted', idx: 3, via: 'earlier-mint' },
  { kind: 'adopted', idx: 4, via: 'own-hip', desigConFromAnchor: true, recurated: null },
  { kind: 'minted', idx: 5, synthetic: true, brightness: { source: 'wds_mag', spectMsFromOwnAbsmag: true }, constellationSplit: true },
  { kind: 'minted', idx: 6, synthetic: false, brightness: own, constellationSplit: false },
  { kind: 'primary-unresolved' },
  { kind: 'unpaired' },
  { kind: 'pair-anchor' },
];
const LINES = OUTCOMES.flatMap((o) => rowsOf(o)).map((r) => stageLineageLine(PROMOTION_CODES, r));

describe('promotionLineageRows', () => {
  it('keys every row on its multiples.tsv row', () => {
    expect(promotionOriginKey(row)).toBe('multiples:22266-1645-AB/B');
    expect(rowsOf({ kind: 'pair-anchor' }).map((r) => r.key)).toEqual(['multiples:22266-1645-AB/B']);
  });

  it('writes each variant\'s outcome code first, then one facet row per flag it carries', () => {
    expect(OUTCOMES.map((o) => rowsOf(o).map((r) => r.code))).toEqual([
      ['promotion.dropped.compound-comp'],
      ['promotion.dropped.parked-record.gaia-5p', 'promotion.fit.owned'],
      ['promotion.dropped.parked-record.other-route'],
      ['promotion.adopted.earlier-mint'],
      ['promotion.adopted.own-hip', 'promotion.desig-con.from-anchor'],
      [
        'promotion.minted.synthetic', 'promotion.brightness.wds-mag', 'promotion.spectral.ms-from-own-absmag',
        'promotion.constellation.split-from-anchor',
      ],
      ['promotion.minted.keyed', 'promotion.brightness.own'],
      ['promotion.parked.primary-unresolved'],
      ['promotion.parked.unpaired'],
      ['promotion.not-applicable.pair-anchor'],
    ]);
    expect(() => stageLineageText(PROMOTION_CODES, sortLineageLines(LINES))).not.toThrow();
  });

  it('writes a facet row with no params and no evidence', () => {
    const facets = rowsOf(OUTCOMES[5]).slice(1);
    expect(facets.map((r) => [paramsOf(r), r.evidence])).toEqual(facets.map(() => [{}, []]));
  });

  it('names an adopted record by its origin key and the re-curation it took', () => {
    const r = outcomeRow({ kind: 'adopted', idx: 4, via: 'own-id', desigConFromAnchor: false, recurated: 'wds_mag' });
    expect(paramsOf(r)).toEqual({ via: 'secondary', record: 'spine:4', recurated: 'wds_mag' });
  });

  it('names the record a merge-effect drop merges into', () => {
    const r = outcomeRow({ kind: 'dropped', reason: 'anchor-is-component', idx: 7 });
    expect(r.code).toBe('promotion.dropped.anchor-is-component');
    expect(paramsOf(r)).toEqual({ via: 'secondary', record: 'spine:7' });
  });

  it('cites the parked record whose refused parallax the row would re-serve', () => {
    const r = outcomeRow({ kind: 'dropped', reason: 'parked-record', parked: 'spine:2', viaGaia5p: false, ownedFit: false });
    expect(r.evidence).toEqual(['spine:7', 'spine:2']);
  });

  it('cites the anchor and a distinct system anchor, never the row itself', () => {
    const cite = (anchors: Partial<PromotedRow>): readonly string[] => outcomeRow({ kind: 'pair-anchor' }, anchors).evidence;
    expect(cite({})).toEqual(['spine:7']);
    expect(cite({ anchor: 'gaia-dr3:9', systemAnchor: 'spine:7' })).toEqual(['gaia-dr3:9', 'spine:7']);
    expect(cite({ anchor: null, systemAnchor: null })).toEqual([]);
    expect(cite({ anchor: 'multiples:22266-1645-AB/B' })).toEqual(['spine:7']);
  });
});

describe('promotion count block', () => {
  it('folds each outcome and facet onto its code, every live code a key', () => {
    const counts = foldStageLines(PROMOTION_CODES, LINES);
    expect(Object.keys(counts)).toEqual([...PROMOTION_CODES.live]);
    expect(counts['promotion.dropped.parked-record.gaia-5p']).toBe(1);
    expect(counts['promotion.dropped.parked-record.other-route']).toBe(1);
    expect(counts['promotion.fit.owned']).toBe(1);
    expect(counts['promotion.minted.synthetic']).toBe(1);
    expect(counts['promotion.minted.keyed']).toBe(1);
    expect(counts['promotion.brightness.wds-mag']).toBe(1);
    expect(counts['promotion.brightness.anchor-collocated']).toBe(0);
    expect(counts['promotion.desig-con.from-anchor']).toBe(1);
  });

  it('a new code reaches the snapshot as a key, and fails the check until the snapshot is refreshed', () => {
    const { drift, refreshed } = seededCodeCheck(PROMOTION_CODES, LINES);
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`promotion.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });

  it('summarises the families as the build log has them', () => {
    const derived: PromotionDerivedCounts = {
      companionRepositionedInnerToParent: 0, companionBlendSplit: 2, companionBlendDimmedAnchors: 3,
      companionBlendDimSkipped: 0, companionBlendDimUnfit: 0, companionBlendDimOutside: 0,
      companionBlendDimGaiaResolved: 0, companionBlendDimBeyondSeparation: 0, companionBlendDimMisfit: 0,
      companionExistingMemberRecurated: { dmag_imputed: 0, wds_mag: 1, spectral: 0, held: 0 }, physicalOverlaps: 0,
    };
    const summary = promotionSummary(foldStageLines(PROMOTION_CODES, LINES), derived, 7);
    expect(summary).toContain('scanned 7 pair rows; promoted 2 (1 via synthetic ID); already-in-catalog 2 ');
    expect(summary).toContain('refused-parked=2 (via gaia_5p 1, owned fit 1)');
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
      promoted({ kind: 'pair-anchor' }),
    ], stars, new Set());
    expect(identity).toEqual([{
      key: 'multiples:22266-1645-AB/B', tyc: '', hip: '', hd: '', gl: '',
      gaia_source_id: '2595463996992115840',
      designations: ['synth:22266-1645-B', 'gaia_dr3:2595463996992115840'],
    }]);
  });

  it('keys a parked or retired row on the identifier cells it arrived with, and skips one whose every designation is founded', () => {
    const standalone = multiplesRow({ systemId: '19082+3829-_C', comp: 'C', hip: 42, gaiaSourceId: '2099222754064121216' });
    const { identity } = promotionLineage([
      { row: standalone, via: 'unpaired', outcome: { kind: 'unpaired' }, anchor: null, systemAnchor: null, synthKey: 'synth-19082+3829-C' },
      promoted({ kind: 'dropped', reason: 'no-absmag' }),
    ], stars, new Set(['synth:22266-1645-B']));
    expect(identity).toEqual([
      {
        key: 'multiples:19082+3829-_C/C', tyc: '', hip: '42', hd: '', gl: '',
        gaia_source_id: '2099222754064121216',
        designations: ['hip:42', 'synth:19082+3829-C', 'gaia_dr3:2099222754064121216'],
      },
    ]);
  });

  it('keys a removed or merged row on the synthetic key a mint from it would carry, and a kept row on nothing', () => {
    const { identity } = promotionLineage([
      promoted({ kind: 'dropped', reason: 'no-absmag' }, { synthKey: 'synth-22266-1645-B' }),
      promoted({ kind: 'adopted', idx: 1, via: 'sameas-bridge', desigConFromAnchor: false, recurated: null }, {
        row: multiplesRow({ systemId: '22266-1645-AC', comp: 'C' }), synthKey: 'synth-22266-1645-C',
      }),
      promoted({ kind: 'pair-anchor' }, { row: multiplesRow({ systemId: '22266-1645-AD', comp: 'A' }), synthKey: 'synth-22266-1645-A' }),
    ], stars, new Set());
    expect(identity.map((r) => [r.key, r.designations])).toEqual([
      ['multiples:22266-1645-AB/B', ['synth:22266-1645-B']],
      ['multiples:22266-1645-AC/C', ['synth:22266-1645-C']],
    ]);
  });

  it('keys a removed row on no designation membership or a mint of this stage already founds', () => {
    const unpaired = (comp: string, cells: { hip?: number; gaiaSourceId?: string }): PromotedRow => ({
      row: multiplesRow({ systemId: '21050+1243-_X', comp, ...cells }),
      via: 'unpaired', outcome: { kind: 'unpaired' }, anchor: null, systemAnchor: null, synthKey: `synth-21050+1243-${comp}`,
    });
    const { identity } = promotionLineage([
      promoted({ kind: 'minted', idx: 1, synthetic: false, brightness: own, constellationSplit: false }),
      unpaired('A', { hip: 104066 }),
      unpaired('B', { gaiaSourceId: '2595463996992115840' }),
      unpaired('C', { hip: 104066, gaiaSourceId: '77' }),
    ], stars, new Set(['hip:104066', 'synth:21050+1243-A', 'synth:21050+1243-B']));
    expect(identity.map((r) => [r.key, r.hip, r.gaia_source_id, r.designations])).toEqual([
      ['multiples:22266-1645-AB/B', '', '2595463996992115840', ['synth:22266-1645-B', 'gaia_dr3:2595463996992115840']],
      ['multiples:21050+1243-_X/C', '', '77', ['synth:21050+1243-C', 'gaia_dr3:77']],
    ]);
  });
});
