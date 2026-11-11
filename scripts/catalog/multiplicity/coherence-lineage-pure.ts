// System distance coherence as a lineage stage: its reason codes and the one serialiser over its verdicts. See README.md#coherence-lineage.

import {
  evidenceTexts, paramsText, stageLineageLine, type LineageLine, type LineageParams, type LineageRow,
} from '../lineage/lineage-row-pure';
import { outcomeCode, stageCodes, type CodeStatus } from '../lineage/reason-codes/reason-codes-pure';
import type { Star } from '../parse/stars-parse';
import { sourceRowRefText } from '../../util/sources/row-ref-pure';
import type { AnchorTier, CoherenceAnchor, MemberVerdict, SystemVerdict } from './system-coherence';
import { COHERENCE_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const COHERENCE_LINEAGE_BUDGET = { gzipBytes: 8_200_000, writeMs: 18_000 };


const RETIRED_7_1_16 = { kind: 'retired', retiredIn: '7.1.16' } as const satisfies CodeStatus;

const ANCHOR = 'The record is its WDS system\'s distance anchor, the best-tier member, and the system\'s snapped members move onto its distance';
const INCONSISTENT = 'The record wins its system\'s anchor pick, but its catalogue distance contradicts its own parallax by more than 3 sigma and 20%, so the system is skipped';
const MEMBER_WON = ': a non-primary member that outranks the pair primary.';
const ANCHOR_WON = ': the pair primary, outranked by no member.';
const PRECISION_VETOED = ': the pair primary, kept because its parallax is more precise than the member that outranks it.';

export const COHERENCE_CODES = stageCodes(COHERENCE_LINEAGE.stage, {
  anchor: outcomeCode(`${ANCHOR}.`, 'none', RETIRED_7_1_16),
  'anchor.member-won': outcomeCode(`${ANCHOR}${MEMBER_WON}`),
  'anchor.anchor-won': outcomeCode(`${ANCHOR}${ANCHOR_WON}`),
  'anchor.precision-vetoed': outcomeCode(`${ANCHOR}${PRECISION_VETOED}`),
  'anchor.inconsistent': outcomeCode(`${INCONSISTENT}.`, 'none', RETIRED_7_1_16),
  'anchor.inconsistent.member-won': outcomeCode(`${INCONSISTENT}${MEMBER_WON}`),
  'anchor.inconsistent.anchor-won': outcomeCode(`${INCONSISTENT}${ANCHOR_WON}`),
  'anchor.inconsistent.precision-vetoed': outcomeCode(`${INCONSISTENT}${PRECISION_VETOED}`),
  'anchor.unplaced': outcomeCode('The record wins its system\'s anchor pick but has no positive finite distance, so the system is skipped.'),
  snapped: outcomeCode('The record moves radially onto its system anchor\'s distance: its parallax gap from the anchor is at most 3 sigma of the combined error, or that error is zero; with no parallax, its distance is within 20% or 1 pc of the anchor\'s.'),
  'unmoved.at-anchor-distance': outcomeCode('The record already sits at its system anchor\'s distance.'),
  'kept.significant-depth': outcomeCode('The record\'s parallax gap from its system anchor is more than 3 sigma of a nonzero combined error, a measured depth, so it keeps its own distance.'),
  'kept.wide-gap': outcomeCode('The record has no parallax error model and sits more than 20% and 1 pc from its system anchor, so it keeps its own distance.'),
  'kept.member-unplaced': outcomeCode('The record has no positive finite distance to move from, so it keeps its own.'),
  'kept.anchor-inconsistent': outcomeCode('The record\'s system anchor contradicts its own parallax, so the system is skipped and the record keeps its own distance.'),
  'kept.anchor-unplaced': outcomeCode('The record\'s system anchor has no positive finite distance, so the system is skipped and the record keeps its own distance.'),
  'not-applicable': outcomeCode('The record is in no kept-physical WDS system with two or more resolved catalogue records, so coherence decides nothing for it.'),
});

type Branch = Parameters<typeof COHERENCE_CODES.code>[0];

type LiveCode = (typeof COHERENCE_CODES.live)[number];

/** Coherence's count block: its lines folded per live code. */
export type CoherenceCounts = Readonly<Record<LiveCode, number>>;

/** The pass's headline figures, each a sum of the block's codes. */
export function coherenceFigures(counts: CoherenceCounts) {
  const n = (...codes: LiveCode[]): number => codes.reduce((sum, code) => sum + counts[code], 0);
  const inconsistent = n(
    'coherence.anchor.inconsistent.member-won', 'coherence.anchor.inconsistent.anchor-won',
    'coherence.anchor.inconsistent.precision-vetoed',
  );
  return {
    systems: inconsistent
      + n('coherence.anchor.member-won', 'coherence.anchor.anchor-won', 'coherence.anchor.precision-vetoed', 'coherence.anchor.unplaced'),
    repositioned: n('coherence.snapped'),
    memberAnchorWins: n('coherence.anchor.member-won', 'coherence.anchor.inconsistent.member-won'),
    precisionVetoed: n('coherence.anchor.precision-vetoed', 'coherence.anchor.inconsistent.precision-vetoed'),
    depthKept: n('coherence.kept.significant-depth', 'coherence.kept.wide-gap'),
    anchorInconsistent: inconsistent,
  };
}

export function coherenceSummary(counts: CoherenceCounts): string {
  const f = coherenceFigures(counts);
  return `  system distance coherence: ${f.repositioned} members repositioned across ${f.systems} systems `
    + `(${f.memberAnchorWins} member-anchor wins, ${f.precisionVetoed} vetoed on precision, `
    + `${f.depthKept} significant depths kept)`;
}

type Flag = 'true' | 'false';
type AnchorParams = { root: string; tier: AnchorTier };
type AnchorPick = 'member-won' | 'anchor-won' | 'precision-vetoed';
type MemberParams = { root: string; anchor: string; anchor_tier: AnchorTier };

/** Each code's params, declared once beside the codes. */
type ParamsOf<B extends Branch> =
  B extends `anchor.inconsistent.${AnchorPick}` ? AnchorParams & { anchor_pc: string; parallax_pc: string; sigma_pc: string }
  : B extends `anchor.${AnchorPick}` ? AnchorParams & { anchor_pc: string }
  : B extends 'anchor.unplaced' ? AnchorParams & { member_won: Flag; precision_vetoed: Flag }
  : B extends 'snapped' ? MemberParams & { from_pc: string; to_pc: string }
  : B extends 'kept.significant-depth' ? MemberParams & { gap_pc: string; sigma_pc: string }
  : B extends 'kept.wide-gap' ? MemberParams & { gap_pc: string }
  : B extends 'not-applicable' ? Record<string, never>
  : MemberParams;

const flag = (b: boolean): Flag => (b ? 'true' : 'false');

/** A veto forces `memberWon` false, so the three are exclusive. */
function anchorPick(a: CoherenceAnchor): AnchorPick {
  if (a.precisionVetoed) return 'precision-vetoed';
  return a.memberWon ? 'member-won' : 'anchor-won';
}
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
        ? [] : evidenceTexts(key, [sourceRowRefText(anchor.ref)]),
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
    const anchorParams: AnchorParams = { root: v.root, tier: a.tier };
    const pick = anchorPick(a);
    const member: MemberParams = { root: v.root, anchor: stars[a.idx].originKey, anchor_tier: a.tier };
    switch (v.kind) {
      case 'coherent':
        push(a.idx, `anchor.${pick}`, { ...anchorParams, anchor_pc: pc(v.anchorPc) }, a);
        for (const m of v.members) memberRow(m, member, a);
        break;
      case 'anchor-inconsistent':
        push(a.idx, `anchor.inconsistent.${pick}`, {
          ...anchorParams, anchor_pc: pc(v.anchorPc), parallax_pc: pc(v.parallaxPc), sigma_pc: pc(v.sigmaPc),
        }, a);
        for (const idx of v.members) push(idx, 'kept.anchor-inconsistent', member, a);
        break;
      case 'anchor-unplaced':
        push(a.idx, 'anchor.unplaced', {
          ...anchorParams, member_won: flag(a.memberWon), precision_vetoed: flag(a.precisionVetoed),
        }, a);
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
