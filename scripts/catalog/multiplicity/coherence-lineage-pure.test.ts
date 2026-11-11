import { describe, expect, it } from 'vitest';

import { compareCountSnapshot } from '../build-counts';
import { foldStageLines, paramsOf, sortLineageLines, stageLineageText } from '../lineage/lineage-row-pure';
import { outcomeCode, stageCodes } from '../lineage/reason-codes/reason-codes-pure';
import { nestByStage } from '../../util/counts/count-stages-pure';
import { gaiaAstrometryRow } from '../sources/gaia-astrometry-fixture';
import { makeStar } from '../parse/star-fixture';
import { sourceRowRefText } from '../../util/sources/row-ref-pure';
import { COHERENCE_CODES, coherenceFigures, coherenceLineageLines, coherenceLineageRows } from './coherence-lineage-pure';
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
      ['spine:1', 'coherence.anchor.anchor-won'],
      ['spine:2', 'coherence.snapped'],
      ['spine:2', 'coherence.anchor.inconsistent.anchor-won'],
      ['spine:3', 'coherence.unmoved.at-anchor-distance'],
      ['spine:3', 'coherence.kept.anchor-inconsistent'],
      ['spine:4', 'coherence.kept.significant-depth'],
      ['spine:4', 'coherence.anchor.unplaced.anchor-won'],
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

  it('codes the anchor row by how the anchor was picked, a veto over the member that lost it', () => {
    const picks = [{ memberWon: true }, {}, { precisionVetoed: true }];
    const verdict = (kind: SystemVerdict['kind'], a: CoherenceAnchor): SystemVerdict => {
      switch (kind) {
        case 'coherent': return { kind, root: '00001+0001', anchor: a, anchorPc: 50, members: [] };
        case 'anchor-inconsistent': return { kind, root: '00001+0001', anchor: a, anchorPc: 50, parallaxPc: 9, sigmaPc: 1, members: [] };
        case 'anchor-unplaced': return { kind, root: '00001+0001', anchor: a, members: [] };
      }
    };
    const code = (kind: SystemVerdict['kind']) => picks.map((o) => [...coherenceLineageRows(
      [verdict(kind, anchor(0, o))], stars.slice(0, 1),
    )][0].code);
    expect(code('coherent')).toEqual(['coherence.anchor.member-won', 'coherence.anchor.anchor-won', 'coherence.anchor.precision-vetoed']);
    expect(code('anchor-inconsistent')).toEqual([
      'coherence.anchor.inconsistent.member-won', 'coherence.anchor.inconsistent.anchor-won',
      'coherence.anchor.inconsistent.precision-vetoed',
    ]);
    expect(code('anchor-unplaced')).toEqual([
      'coherence.anchor.unplaced.member-won', 'coherence.anchor.unplaced.anchor-won',
      'coherence.anchor.unplaced.precision-vetoed',
    ]);
    const [anchorRow] = coherenceLineageRows([{
      kind: 'coherent', root: '00001+0001', anchor: anchor(0, { memberWon: true }), anchorPc: 50, members: [],
    }], stars.slice(0, 1));
    expect(paramsOf(anchorRow)).toEqual({ root: '00001+0001', tier: 'gaia-clean', anchor_pc: '50' });
  });

  it('cites nothing for an inherited anchor', () => {
    const rows = [...coherenceLineageRows([{
      kind: 'anchor-unplaced', root: '00003+0003', anchor: anchor(0, {}, INHERITED), members: [1],
    }], stars.slice(0, 2))];
    expect(rows.map((r) => r.evidence)).toEqual([[], []]);
  });
});

describe('the coherence count block', () => {
  const verdicts: SystemVerdict[] = [{
    kind: 'coherent', root: '00001+0001', anchor: anchor(0, { memberWon: true }), anchorPc: 50,
    members: [{ kind: 'snapped', idx: 1, fromPc: 52, toPc: 50 }],
  }];
  const lines = coherenceLineageLines(verdicts, stars.slice(0, 3));
  const snapshot = (counts: Readonly<Record<string, number>>) => nestByStage(
    {}, { order: ['coherence'], of: {} }, [{ stage: 'coherence', block: { kind: 'counted', counts } }],
  );

  it('keys every live code, zeros included, and no retired one', () => {
    const counts = foldStageLines(COHERENCE_CODES, lines);
    expect(Object.keys(counts)).toEqual(COHERENCE_CODES.live);
    expect(counts).toMatchObject({
      'coherence.anchor.member-won': 1, 'coherence.snapped': 1, 'coherence.not-applicable': 1, 'coherence.kept.wide-gap': 0,
    });
    expect(Object.keys(counts)).not.toContain('coherence.anchor');
    expect(coherenceFigures(counts)).toEqual({
      systems: 1, repositioned: 1, memberAnchorWins: 1, precisionVetoed: 0, depthKept: 0, anchorInconsistent: 0,
    });
  });

  it('a new code reaches the snapshot as a key, and fails the check until the snapshot is refreshed', () => {
    const committed = snapshot(foldStageLines(COHERENCE_CODES, lines));
    const seeded = stageCodes(COHERENCE_CODES.stage, { ...COHERENCE_CODES.declarations, seeded: outcomeCode('A new rule.') });
    const built = snapshot(foldStageLines(seeded, lines));
    const check = compareCountSnapshot<object>(committed, built);
    expect(check.drifted).toBe(true);
    expect(check.report).toContain('coherence.seeded');
    expect(compareCountSnapshot<object>(built, built).drifted).toBe(false);
  });
});
