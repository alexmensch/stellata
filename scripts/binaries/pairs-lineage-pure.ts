// Every WDS pair row the binaries pipeline decides, keyed on its founding row, as the `pairs` lineage stage. See README.md#pairs-lineage.

import { stageLineageLine, stageRow, type LineageLine, type LineageParams, type LineageRow } from '../catalog/lineage/lineage-row-pure';
import { outcomeCode, stageCodes, type CodeDeclaration, type StageCounts } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { hipDesignation } from '../sid/sid-pure';
import { sourceRowRefText } from '../util/sources/row-ref-pure';
import type { BlankRescueOutcome } from './load/blank-rescue-pure';
import type { ReferenceCatalogs } from './load/reference-catalogs';
import type { Stage6Result } from './multiples/attach-multiples';
import type { Stage5Result } from './optical/attach-optical';
import { OPTICAL_VIA, OPTICAL_VIA_PROPERTIES } from './optical/optical-tiers-pure';
import { valueOf, type DecomposedPair, type ResolvedComponent } from './resolve/components-pure';
import { PAIRS_LINEAGE } from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const PAIRS_LINEAGE_BUDGET = { gzipBytes: 2_600_000, writeMs: 2_000 };

type UnpairedBlank = Exclude<BlankRescueOutcome, 'rescued'>;

const UNPAIRED_BLANKS: Record<UnpairedBlank, string> = {
  deferred: 'A blank-components row with no ORB6 orbit or SIMBAD cross-ID for its system, left for the full blank → AB ingest.',
  donor: 'A blank-components row whose measurements an ORB6 orphan pair of its discoverer took; the orphan carries the pair on.',
  enumerated: 'A blank-components row of a system that already has an AB pair, so promoting it would write the pair twice.',
};

/** A snake_case tag as a code branch's dash-separated word. */
type Kebab<T extends string> = T extends `${infer A}_${infer B}` ? `${A}-${Kebab<B>}` : T;

function kebab<T extends string>(tag: T): Kebab<T> {
  return tag.replaceAll('_', '-') as Kebab<T>;
}

function codesOf<T extends string, P extends string>(
  prefix: P, tags: readonly T[], description: (tag: T) => string,
): Record<`${P}${Kebab<T>}`, CodeDeclaration> {
  return Object.fromEntries(
    tags.map((tag) => [`${prefix}${kebab(tag)}`, outcomeCode(description(tag))]),
  ) as Record<`${P}${Kebab<T>}`, CodeDeclaration>;
}

export const PAIRS_CODES = stageCodes(PAIRS_LINEAGE.stage, {
  'duplicate-row': outcomeCode('A WDS summary row repeating another\'s wds_id, discoverer and components; the more-observed row is kept.'),
  ...codesOf('blank-', Object.keys(UNPAIRED_BLANKS) as UnpairedBlank[], (b) => UNPAIRED_BLANKS[b]),
  ...codesOf('optical.', OPTICAL_VIA, (via) => OPTICAL_VIA_PROPERTIES[via].description),
  'no-position': outcomeCode('A pair Stage 5 kept with no position on either side and no system anchor, so it never reaches multiples.tsv.'),
});

/** Pairs' count block: its lines folded per live code. */
export type PairsCounts = StageCounts<typeof PAIRS_CODES>;

export interface PairDecisions {
  readonly reference: Pick<ReferenceCatalogs, 'wdsDedup' | 'blankRescue'>;
  readonly optical: Stage5Result;
  readonly multiples: Pick<Stage6Result, 'droppedNoPosition'>;
}

function sideParams(side: 'primary' | 'secondary', c: ResolvedComponent): LineageParams {
  const gaia = valueOf(c.gaia);
  const hip = valueOf(c.hip);
  return {
    [side]: c.component,
    ...(gaia === null ? {} : { [`${side}_gaia`]: gaia }),
    ...(hip === null ? {} : { [`${side}_hip`]: hipDesignation(hip) }),
  };
}

function pairParams(p: DecomposedPair): LineageParams {
  return { ...sideParams('primary', p.primary), ...sideParams('secondary', p.secondary) };
}

export function* pairsLineageRows({ reference, optical, multiples }: PairDecisions): Generator<LineageRow> {
  for (const { row, outcome } of reference.wdsDedup) {
    if (outcome === 'dropped') yield stageRow(PAIRS_CODES, sourceRowRefText(row.origin), 'duplicate-row', {}, []);
  }
  for (const d of reference.blankRescue) {
    if (d.outcome === 'rescued') continue;
    const evidence = d.outcome === 'donor' ? d.donatedTo.map((p) => sourceRowRefText(p.origin)) : [];
    yield stageRow(PAIRS_CODES, sourceRowRefText(d.row.origin), `blank-${d.outcome}`, {}, evidence);
  }
  for (const [p, via] of optical.optical) {
    yield stageRow(PAIRS_CODES, sourceRowRefText(p.pair.origin), `optical.${kebab(via)}`, pairParams(p), []);
  }
  for (const p of multiples.droppedNoPosition) {
    yield stageRow(PAIRS_CODES, sourceRowRefText(p.pair.origin), 'no-position', pairParams(p), []);
  }
}

export function pairsLineageLines(decisions: PairDecisions): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of pairsLineageRows(decisions)) lines.push(stageLineageLine(PAIRS_CODES, row));
  return lines;
}
