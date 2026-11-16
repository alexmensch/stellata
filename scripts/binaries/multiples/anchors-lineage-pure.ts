// Stage 6's anchor per system as the anchors lineage stage: the anchor and why, each kept primary it outranked, and its binding. See README.md#anchors-lineage.

import { namedExceptionsInvariant, type LineageInvariant } from '../../catalog/lineage/lineage-invariant-pure';
import { stageLineageLine, stageRow, type LineageLine, type LineageRow } from '../../catalog/lineage/lineage-row-pure';
import { kebab, outcomeCode, refusalCode, stageCodes, taggedCodes } from '../../catalog/lineage/reason-codes/reason-codes-pure';
import { ANCHOR_RANK_STEPS, type AnchorRankStep } from '../component-tokens-pure';
import { componentRowKey } from '../multiples-row-key-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { componentIdParams } from '../resolve/resolve-lineage-pure';
import { ANCHOR_BINDINGS, type AnchorBindingKind, type SystemAnchor } from './anchor-binding-pure';
import { ANCHORS_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const ANCHORS_LINEAGE_BUDGET = { gzipBytes: 600_000, writeMs: 1_000 };

const STEP_TEXT: Record<AnchorRankStep, string> = {
  letter: 'its top-level letter',
  length: 'its token length, a shallower component',
  alphabetical: 'alphabetical order',
};

const BINDING_TEXT: Record<AnchorBindingKind, string> = {
  bound: 'The anchor is a primary binding a Gaia source or HIP, so companion promotion can anchor on it.',
  re_basable: 'The anchor binds no Gaia source or HIP; the most canonical primary that does, which promotion anchors on, is reached by the anchor\'s chain, so promotion re-bases every offset onto it.',
  promotion_anchor_unreached: 'The anchor binds no Gaia source or HIP, and the anchor\'s chain never reaches the most canonical primary that does, so promotion refuses every offset of the system.',
  no_bound_primary: 'No primary of the system binds a Gaia source or HIP, though a secondary does, so promotion has no anchor for it.',
  nothing_bound: 'No component of the system binds a Gaia source or HIP.',
  unplaced: 'Stage 6 placed none of the system\'s kept pairs, so it has no rows.',
};

export const ANCHORS_CODES = stageCodes(ANCHORS_LINEAGE.stage, {
  'chosen.sole': outcomeCode('The system\'s anchor: its only kept-pair primary.'),
  ...taggedCodes('chosen.', ANCHOR_RANK_STEPS, (step) => outcomeCode(
    `The system's anchor: its most canonical kept-pair primary, ahead of the next on ${STEP_TEXT[step]}.`,
  )),
  ...taggedCodes('ranked-out.', ANCHOR_RANK_STEPS, (step) => refusalCode(`A kept-pair primary the anchor outranked on ${STEP_TEXT[step]}.`)),
  ...taggedCodes('binding.', ANCHOR_BINDINGS, (kind) => outcomeCode(BINDING_TEXT[kind])),
});

const primaryRowKey = (p: DecomposedPair): string => componentRowKey(p.pair, p.primary.component);

export function* anchorsLineageRows(anchors: ReadonlyMap<string, SystemAnchor>): Generator<LineageRow> {
  for (const { choice, binding } of anchors.values()) {
    const key = primaryRowKey(choice.pair);
    const reason = choice.rankedOut.length === 0 ? 'sole' : choice.rankedOut[0].step;
    yield stageRow(ANCHORS_CODES, key, `chosen.${reason}`, { anchor: choice.pair.primary.component, ...componentIdParams(choice.pair.primary) }, []);
    for (const { pair, step } of choice.rankedOut) {
      yield stageRow(ANCHORS_CODES, key, `ranked-out.${step}`, { candidate: pair.primary.component, ...componentIdParams(pair.primary) }, [primaryRowKey(pair)]);
    }
    if ('boundPrimary' in binding) {
      const p = binding.boundPrimary;
      yield stageRow(ANCHORS_CODES, key, `binding.${kebab(binding.kind)}`, { bound_primary: p.primary.component, ...componentIdParams(p.primary) }, [primaryRowKey(p)]);
    } else {
      yield stageRow(ANCHORS_CODES, key, `binding.${kebab(binding.kind)}`, {}, []);
    }
  }
}

export function anchorsLineageLines(anchors: ReadonlyMap<string, SystemAnchor>): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of anchorsLineageRows(anchors)) lines.push(stageLineageLine(ANCHORS_CODES, row));
  return lines;
}

const UNREACHED: readonly (readonly [wdsId: string, components: string, anchor: string, boundPrimary: string])[] = [
  ['00108+5846', 'AB', 'A', 'Ca'], ['01155-4549', 'AB', 'A', 'Ca'], ['02007+0456', 'AB', 'A', 'Da'], ['04327+2553', 'Aa,Ab', 'Aa', 'Ba'],
  ['05154+3241', 'BC', 'B', 'Ca'], ['05352-0523', 'AB', 'A', 'D'], ['05353-0521', 'AB', 'A', 'H'], ['05353-0524', 'AB', 'A', 'Ia'],
  ['05354-0517', 'AB', 'A', 'C'], ['05354-0522', 'Aa,Ab', 'Aa', 'Ba'], ['05407-4327', 'A,BC', 'A', 'Ba'], ['05416-0153', 'AB', 'A', 'C'],
  ['08399+1933', 'AB', 'A', 'Ca'], ['13122+3214', 'Aa,Ab', 'Aa', 'Ba'], ['16509+3556', 'AB', 'A', 'Ca'], ['18274-1838', 'AB', 'A', 'D'],
  ['19306+2817', 'Aa,Ab', 'Aa', 'Ba'], ['21065+2655', 'AB', 'A', 'Ba'], ['22545+1517', 'AB', 'A', 'Ca'],
];

export const ANCHORS_INVARIANTS: readonly LineageInvariant[] = [
  namedExceptionsInvariant(
    ANCHORS_CODES, 'binding.promotion-anchor-unreached',
    'promotion can re-base every system\'s offsets onto its anchor, but the systems named',
    new Map(UNREACHED.map(([wdsId, components, anchor, boundPrimary]) => [
      componentRowKey({ wdsId, components }, anchor), `no measured edge links anchor ${anchor} to ${boundPrimary}, the bound primary promotion anchors on`,
    ])),
  ),
];
