// Every WDS pair row the binaries pipeline decides, keyed on its founding row, as the `pairs` lineage stage. See README.md#pairs-lineage.

import { identityRow, type IdentityRow } from '../catalog/lineage/identity/identity-pure';
import { stageLines, stageRow, type LineageLine, type LineageParams, type LineageRow } from '../catalog/lineage/lineage-row-pure';
import { kebab, outcomeCode, retired, stageCodes, taggedCodes, type StageCounts } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { synthDesignation } from '../sid/sid-pure';
import { sourceRowRefText } from '../util/sources/row-ref-pure';
import { pairSyntheticIds, rowSyntheticId } from './component-tokens-pure';
import type { BlankRescueOutcome } from './load/blank-rescue-pure';
import type { ReferenceCatalogs } from './load/reference-catalogs';
import type { Stage6Result } from './multiples/attach-multiples';
import type { MultiplesRecord } from './multiples-record-pure';
import type { Stage5Result } from './optical/attach-optical';
import {
  isRejectedVia, OPTICAL_KEPT_VIA, OPTICAL_REJECT_VIA, OPTICAL_VIA_PROPERTIES, type OpticalVia, type RejectedVia,
} from './optical/optical-tiers-pure';
import type { DecomposedPair, ResolvedComponent } from './resolve/components-pure';
import { componentIdParams } from './resolve/resolve-lineage-pure';
import { PAIRS_LINEAGE } from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const PAIRS_LINEAGE_BUDGET = { gzipBytes: 2_600_000, writeMs: 2_000 };

type UnpairedBlank = Exclude<BlankRescueOutcome, 'rescued'>;

const UNPAIRED_BLANKS: Record<UnpairedBlank, string> = {
  deferred: 'A blank-components row with no ORB6 orbit or SIMBAD cross-ID for its system, left for the full blank → AB ingest.',
  donor: 'A blank-components row whose measurements an ORB6 orphan pair of its discoverer took; the orphan carries the pair on.',
  enumerated: 'A blank-components row of a system that already has an AB pair, so promoting it would write the pair twice.',
};

type RejectionTier<V extends RejectedVia> = V extends `${infer T}_rejected` ? T : never;

const rejectionTier = <V extends RejectedVia>(via: V): RejectionTier<V> => via.replace(/_rejected$/, '') as RejectionTier<V>;
const REJECTION_TIERS = OPTICAL_REJECT_VIA.map(rejectionTier);

const RETIRED_7_1_31 = retired('7.1.31');
const DEPARTED = 'A component it names that no kept pair names leaves multiples.tsv, so a SID keyed on that component\'s synthetic key retires.';

export const PAIRS_CODES = stageCodes(PAIRS_LINEAGE.stage, {
  'duplicate-row': outcomeCode('A WDS summary row repeating another\'s wds_id, discoverer and components; the more-observed row is kept.'),
  ...taggedCodes('blank-', Object.keys(UNPAIRED_BLANKS) as UnpairedBlank[], (b) => outcomeCode(UNPAIRED_BLANKS[b])),
  ...taggedCodes('optical.', OPTICAL_KEPT_VIA, (via) => outcomeCode(OPTICAL_VIA_PROPERTIES[via].description)),
  ...taggedCodes('optical.', OPTICAL_REJECT_VIA, (via) => outcomeCode(OPTICAL_VIA_PROPERTIES[via].description, 'none', RETIRED_7_1_31)),
  ...taggedCodes('rejected.', REJECTION_TIERS, (tier) => outcomeCode(
    `${OPTICAL_VIA_PROPERTIES[`${tier}_rejected`].description} ${DEPARTED}`, 'retire',
  )),
  'no-position': outcomeCode('A pair Stage 5 kept with no position on either side and no system anchor, so it never reaches multiples.tsv.'),
});

/** Pairs' count block: its lines folded per live code. */
export type PairsCounts = StageCounts<typeof PAIRS_CODES>;

export interface PairDecisions {
  readonly reference: Pick<ReferenceCatalogs, 'wdsDedup' | 'blankRescue'>;
  readonly optical: Stage5Result;
  readonly multiples: Pick<Stage6Result, 'droppedNoPosition'> & {
    readonly rows: readonly Pick<MultiplesRecord, 'systemId' | 'comp' | 'orbitRole'>[];
  };
}

function sideParams(side: 'primary' | 'secondary', c: ResolvedComponent): LineageParams {
  const ids = Object.entries(componentIdParams(c)).map(([key, value]) => [`${side}_${key}`, value]);
  return { [side]: c.component, ...Object.fromEntries(ids) };
}

/** Each side's letter, Gaia source and `hip:`, the forms trace matches a pair on. */
export function pairParams(p: DecomposedPair): LineageParams {
  return { ...sideParams('primary', p.primary), ...sideParams('secondary', p.secondary) };
}

function opticalCode(via: OpticalVia) {
  return isRejectedVia(via) ? `rejected.${kebab(rejectionTier(via))}` as const : `optical.${kebab(via)}` as const;
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
    yield stageRow(PAIRS_CODES, sourceRowRefText(p.pair.origin), opticalCode(via), pairParams(p), []);
  }
  for (const p of multiples.droppedNoPosition) {
    yield stageRow(PAIRS_CODES, sourceRowRefText(p.pair.origin), 'no-position', pairParams(p), []);
  }
}

export function pairsLineageLines(decisions: PairDecisions): LineageLine[] {
  return stageLines(PAIRS_CODES, pairsLineageRows(decisions));
}

const sideSyntheticIds = (p: DecomposedPair) => pairSyntheticIds(p.primary.wdsId, p.primary.component, p.secondary.component);

/** One identity row per pair Stage 5 rejected that names a component no pair Stage 5 kept names and no multiples.tsv row composes, carrying that component's synthetic key, so a SID keyed on it joins the rejection's retire. */
export function pairsIdentity({ optical, multiples }: Pick<PairDecisions, 'optical' | 'multiples'>): IdentityRow[] {
  const decided = [...optical.optical];
  const named = new Set([
    ...multiplesSyntheticIds(multiples.rows),
    ...decided.flatMap(([p, via]) => (isRejectedVia(via) ? [] : sideSyntheticIds(p))),
  ]);
  const rows: IdentityRow[] = [];
  for (const [p, via] of decided) {
    if (!isRejectedVia(via)) continue;
    const departed = [...new Set(sideSyntheticIds(p))].filter((id) => !named.has(id));
    if (departed.length === 0) continue;
    rows.push(identityRow(
      sourceRowRefText(p.pair.origin), { tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '' }, departed.map(synthDesignation),
    ));
  }
  return rows;
}

/** Every synthetic key a multiples.tsv row composes. */
function multiplesSyntheticIds(rows: Pick<PairDecisions, 'multiples'>['multiples']['rows']): Set<string> {
  const primaryComp = new Map(rows.filter((r) => r.orbitRole === 'primary').map((r) => [r.systemId, r.comp]));
  return new Set(rows.map((r) => rowSyntheticId(r, primaryComp.get(r.systemId) ?? null)));
}
