// System distance coherence as a lineage stage: its reason codes and the one serialiser over its verdicts. See ../lineage/README.md#the-coherence-stage.

import { paramsText, stageLineageLine, type LineageLine, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { LIVE, stageCodes, type CodeDeclaration } from '../lineage/reason-codes-pure';
import type { Star } from '../parse/stars-parse';
import { sourceRowRefText } from '../../util/sources/row-ref-pure';
import type { AnchorTier, CoherenceAnchor, MemberVerdict, SystemVerdict } from './system-coherence';
import { COHERENCE_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const COHERENCE_LINEAGE_BUDGET = { gzipBytes: 8_200_000, writeMs: 15_000 };

const live = (description: string): CodeDeclaration => ({ description, effect: 'none', status: LIVE });

export const COHERENCE_CODES = stageCodes(COHERENCE_LINEAGE.stage, {
  anchor: live('The record is its WDS system\'s distance anchor, the best-tier member, and the system\'s snapped members move onto its distance.'),
  'anchor.inconsistent': live('The record wins its system\'s anchor pick, but its catalogue distance contradicts its own parallax by more than 3 sigma and 20%, so the system is skipped.'),
  'anchor.unplaced': live('The record wins its system\'s anchor pick but has no positive finite distance, so the system is skipped.'),
  snapped: live('The record moves radially onto its system anchor\'s distance: its parallax gap from the anchor is under 3 sigma of the combined error, or, with no error model, within 20% or 1 pc.'),
  'unmoved.at-anchor-distance': live('The record already sits at its system anchor\'s distance.'),
  'kept.significant-depth': live('The record\'s parallax gap from its system anchor is at least 3 sigma of the combined error, a measured depth, so it keeps its own distance.'),
  'kept.wide-gap': live('The record has no parallax error model and sits more than 20% and 1 pc from its system anchor, so it keeps its own distance.'),
  'kept.member-unplaced': live('The record has no positive finite distance to move from, so it keeps its own.'),
  'kept.anchor-inconsistent': live('The record\'s system anchor contradicts its own parallax, so the system is skipped and the record keeps its own distance.'),
  'kept.anchor-unplaced': live('The record\'s system anchor has no positive finite distance, so the system is skipped and the record keeps its own distance.'),
  'not-applicable': live('The record is in no kept-physical WDS system with two or more resolved catalogue records, so coherence decides nothing for it.'),
});

type Branch = Parameters<typeof COHERENCE_CODES.code>[0];

type Flag = 'true' | 'false';
type AnchorParams = { root: string; tier: AnchorTier; member_won: Flag; precision_vetoed: Flag };
type MemberParams = { root: string; anchor: string; anchor_tier: AnchorTier };

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends 'anchor' ? AnchorParams & { anchor_pc: string }
  : B extends 'anchor.inconsistent' ? AnchorParams & { anchor_pc: string; parallax_pc: string; sigma_pc: string }
  : B extends 'anchor.unplaced' ? AnchorParams
  : B extends 'snapped' ? MemberParams & { from_pc: string; to_pc: string }
  : B extends 'kept.significant-depth' ? MemberParams & { gap_pc: string; sigma_pc: string }
  : B extends 'kept.wide-gap' ? MemberParams & { gap_pc: string }
  : B extends 'not-applicable' ? Record<string, never>
  : MemberParams;

const flag = (b: boolean): Flag => (b ? 'true' : 'false');
const pc = (n: number): string => String(n);

/** Every record's rows: each system verdict's anchor and member rows, and
 *  `coherence.not-applicable` for a record no system decided. */
export function* coherenceLineageRows(verdicts: readonly SystemVerdict[], stars: readonly Star[]): Generator<LineageRow> {
  const row = <B extends Branch>(
    idx: number, branch: B, params: ParamsOf<B>, anchor: CoherenceAnchor | null,
  ): LineageRow => {
    const key = stars[idx].originKey;
    return {
      stage: COHERENCE_LINEAGE.stage, key, role: 'outcome', code: COHERENCE_CODES.code(branch),
      params: paramsText(params as LineageParams),
      evidence: anchor === null || anchor.tier === 'inherited'
        ? [] : [sourceRowRefText(anchor.ref)].filter((t) => t !== key),
    };
  };
  const byIdx = new Map<number, LineageRow[]>();
  const push = <B extends Branch>(idx: number, branch: B, params: ParamsOf<B>, anchor: CoherenceAnchor): void => {
    const decided = byIdx.get(idx);
    if (decided === undefined) byIdx.set(idx, [row(idx, branch, params, anchor)]);
    else decided.push(row(idx, branch, params, anchor));
  };

  for (const v of verdicts) {
    const a = v.anchor;
    const anchorParams: AnchorParams = {
      root: v.root, tier: a.tier, member_won: flag(a.memberWon), precision_vetoed: flag(a.precisionVetoed),
    };
    const member: MemberParams = { root: v.root, anchor: stars[a.idx].originKey, anchor_tier: a.tier };
    switch (v.kind) {
      case 'coherent':
        push(a.idx, 'anchor', { ...anchorParams, anchor_pc: pc(v.anchorPc) }, a);
        for (const m of v.members) memberRow(m, member, a);
        break;
      case 'anchor-inconsistent':
        push(a.idx, 'anchor.inconsistent', {
          ...anchorParams, anchor_pc: pc(v.anchorPc), parallax_pc: pc(v.parallaxPc), sigma_pc: pc(v.sigmaPc),
        }, a);
        for (const idx of v.members) push(idx, 'kept.anchor-inconsistent', member, a);
        break;
      case 'anchor-unplaced':
        push(a.idx, 'anchor.unplaced', anchorParams, a);
        for (const idx of v.members) push(idx, 'kept.anchor-unplaced', member, a);
        break;
      default: {
        const unmapped: never = v;
        throw new Error(`coherence verdict with no row mapping: ${JSON.stringify(unmapped)}`);
      }
    }
  }

  function memberRow(m: MemberVerdict, member: MemberParams, a: CoherenceAnchor): void {
    switch (m.kind) {
      case 'snapped':
        push(m.idx, 'snapped', { ...member, from_pc: pc(m.fromPc), to_pc: pc(m.toPc) }, a);
        return;
      case 'at-anchor-distance':
        push(m.idx, 'unmoved.at-anchor-distance', member, a);
        return;
      case 'significant-depth':
        push(m.idx, 'kept.significant-depth', { ...member, gap_pc: pc(m.gapPc), sigma_pc: pc(m.sigmaPc) }, a);
        return;
      case 'wide-gap':
        push(m.idx, 'kept.wide-gap', { ...member, gap_pc: pc(m.gapPc) }, a);
        return;
      case 'member-unplaced':
        push(m.idx, 'kept.member-unplaced', member, a);
        return;
      default: {
        const unmapped: never = m;
        throw new Error(`coherence member verdict with no row mapping: ${JSON.stringify(unmapped)}`);
      }
    }
  }

  for (let idx = 0; idx < stars.length; idx++) {
    const decided = byIdx.get(idx);
    if (decided !== undefined) {
      yield* decided;
      continue;
    }
    yield row(idx, 'not-applicable', {}, null);
  }
}

/** Lines, never rows: the stage covers every record, so its rows are not held as objects. */
export function coherenceLineageLines(verdicts: readonly SystemVerdict[], stars: readonly Star[]): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of coherenceLineageRows(verdicts, stars)) lines.push(stageLineageLine(COHERENCE_CODES, row));
  return lines;
}
