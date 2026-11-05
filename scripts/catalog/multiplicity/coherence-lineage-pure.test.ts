import { describe, expect, it } from 'vitest';

import { paramsOf, sortLineageLines, stageLineageText } from '../lineage/lineage-row-pure';
import { gaiaAstrometryRow } from '../sources/gaia-astrometry-fixture';
import { makeStar } from '../parse/star-fixture';
import { sourceRowRefText } from '../../util/sources/row-ref-pure';
import { COHERENCE_CODES, coherenceLineageLines, coherenceLineageRows } from './coherence-lineage-pure';
import type { AnchorBasis, CoherenceAnchor, SystemVerdict } from './system-coherence';

const stars = ['spine:1', 'spine:2', 'spine:3', 'spine:4', 'spine:5', 'spine:6'].map((originKey) => makeStar({ originKey }));
const gaia = gaiaAstrometryRow({});
const INHERITED: AnchorBasis = { tier: 'inherited' };
const anchor = (
  idx: number, o: Partial<Pick<CoherenceAnchor, 'memberWon' | 'precisionVetoed'>> = {},
  basis: AnchorBasis = { tier: 'gaia-clean', ref: gaia.ref },
): CoherenceAnchor => ({ ...basis, idx, memberWon: false, precisionVetoed: false, ...o });

describe('coherenceLineageRows', () => {
  it('writes not-applicable, with no params or evidence, for every record no system decided', () => {
    const rows = [...coherenceLineageRows([], stars.slice(0, 2))];
    expect(rows).toEqual(['spine:1', 'spine:2'].map((key) => ({
      stage: 'coherence', key, role: 'outcome', code: 'coherence.not-applicable', params: '', evidence: [],
    })));
  });

  it('writes every verdict a code the writer accepts', () => {
    const verdicts: SystemVerdict[] = [
      {
        kind: 'coherent', root: '00001+0001', anchor: anchor(0), anchorPc: 50,
        members: [
          { kind: 'snapped', idx: 1, fromPc: 52, toPc: 50 },
          { kind: 'at-anchor-distance', idx: 2 },
          { kind: 'significant-depth', idx: 3, gapPc: 9, sigmaPc: 1 },
          { kind: 'wide-gap', idx: 4, gapPc: 30 },
          { kind: 'member-unplaced', idx: 5 },
        ],
      },
      { kind: 'anchor-inconsistent', root: '00002+0002', anchor: anchor(1), anchorPc: 1686, parallaxPc: 534, sigmaPc: 210, members: [2] },
      { kind: 'anchor-unplaced', root: '00003+0003', anchor: anchor(3, {}, INHERITED), members: [4] },
    ];
    const rows = [...coherenceLineageRows(verdicts, stars)];
    expect(rows.map((r) => [r.key, r.code])).toEqual([
      ['spine:1', 'coherence.anchor'],
      ['spine:2', 'coherence.snapped'],
      ['spine:2', 'coherence.anchor.inconsistent'],
      ['spine:3', 'coherence.unmoved.at-anchor-distance'],
      ['spine:3', 'coherence.kept.anchor-inconsistent'],
      ['spine:4', 'coherence.kept.significant-depth'],
      ['spine:4', 'coherence.anchor.unplaced'],
      ['spine:5', 'coherence.kept.wide-gap'],
      ['spine:5', 'coherence.kept.anchor-unplaced'],
      ['spine:6', 'coherence.kept.member-unplaced'],
    ]);
    const lines = sortLineageLines(coherenceLineageLines(verdicts, stars));
    expect(() => stageLineageText(COHERENCE_CODES, lines)).not.toThrow();
  });

  it('names a snapped record\'s anchor, tier and both distances, and cites the anchor\'s row', () => {
    const [snapped] = coherenceLineageRows([{
      kind: 'coherent', root: '02318+8916', anchor: anchor(1, { memberWon: true }), anchorPc: 137.233,
      members: [{ kind: 'snapped', idx: 0, fromPc: 132.626, toPc: 137.233 }],
    }], stars.slice(0, 2));
    expect(snapped.key).toBe('spine:1');
    expect(paramsOf(snapped)).toEqual({
      root: '02318+8916', anchor: 'spine:2', anchor_tier: 'gaia-clean', from_pc: '132.626', to_pc: '137.233',
    });
    expect(snapped.evidence).toEqual([sourceRowRefText(gaia.ref)]);
  });

  it('flags a member anchor and a precision veto on the anchor row', () => {
    const [anchorRow] = coherenceLineageRows([{
      kind: 'coherent', root: '00001+0001', anchor: anchor(0, { memberWon: true, precisionVetoed: true }), anchorPc: 50, members: [],
    }], stars.slice(0, 1));
    expect(paramsOf(anchorRow)).toEqual({
      root: '00001+0001', tier: 'gaia-clean', member_won: 'true', precision_vetoed: 'true', anchor_pc: '50',
    });
  });

  it('cites nothing for an inherited anchor', () => {
    const rows = [...coherenceLineageRows([{
      kind: 'anchor-unplaced', root: '00003+0003', anchor: anchor(0, {}, INHERITED), members: [1],
    }], stars.slice(0, 2))];
    expect(rows.map((r) => r.evidence)).toEqual([[], []]);
  });
});
