// Stage 3's decisions per WDS component as the astrometry lineage stage: the route it took, citing the row it read, and each AT-HYG match refused. See README.md#astrometry-lineage.

import { namedExceptionsInvariant, type LineageInvariant } from '../../catalog/lineage/lineage-invariant-pure';
import {
  foldStageLines, stageLineageLine, stageRow, type LineageLine, type LineageParams, type LineageRow,
} from '../../catalog/lineage/lineage-row-pure';
import { kebab, outcomeCode, refusalCode, stageCodes, taggedCodes, type Kebab } from '../../catalog/lineage/reason-codes/reason-codes-pure';
import { hipDesignation } from '../../sid/sid-pure';
import { sourceRowRefText } from '../../util/sources/row-ref-pure';
import { componentRowKey } from '../multiples-row-key-pure';
import type { ResolvedComponent } from '../resolve/components-pure';
import { componentIdParams } from '../resolve/resolve-lineage-pure';
import type { Stage3Result } from './attach-astrometry';
import { ROUTED_VIA, type ComponentAstrometry, type RoutedVia } from './routes-pure';
import { ASTROMETRY_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const ASTROMETRY_LINEAGE_BUDGET = { gzipBytes: 1_300_000, writeMs: 2_000 };

type MeasuredVia = Exclude<RoutedVia, 'unresolved'>;
const MEASURED_VIA = ROUTED_VIA.filter((v): v is MeasuredVia => v !== 'unresolved');

const ROUTE_DESCRIPTIONS: Record<MeasuredVia, string> = {
  gaia_nss_systemic: 'The component\'s Gaia 5p row, read as the NSS orbit\'s systemic motion: the source carries an NSS orbit and its 5p fit is unreliable.',
  hip2_long_baseline: 'The component\'s HIP2 row: Gaia has no usable parallax for it, or a close pair\'s Gaia and HIP2 proper motions disagree.',
  gaia_5p: 'The component\'s own Gaia 5p row.',
  athyg_position: 'An AT-HYG row matched on position, the Gaia / HIP2 cascade having reached nothing.',
};

export const ASTROMETRY_CODES = stageCodes(ASTROMETRY_LINEAGE.stage, {
  ...taggedCodes('route.', MEASURED_VIA, (via) => outcomeCode(ROUTE_DESCRIPTIONS[via])),
  'route.unresolved.nothing-bound': outcomeCode('No route reached the component, which binds no Gaia source, HIP or AT-HYG row.'),
  'route.unresolved.identifier-bound': outcomeCode('No route reached the component, though it binds a Gaia source, a HIP or an AT-HYG row.'),
  'refused.athyg-match-sibling-claimed': refusalCode('An AT-HYG position match refused: another hierarchy-disjoint, non-partner letter of the system already binds its HIP.'),
});

type AstrometryBranch = Parameters<typeof ASTROMETRY_CODES.code>[0];

const bound = (c: ResolvedComponent): boolean => c.gaia !== null || c.hip !== null || c.athyg !== null;

function routeBranch(c: ResolvedComponent, a: ComponentAstrometry): AstrometryBranch {
  if (a.astrometryVia !== 'unresolved') return `route.${kebab(a.astrometryVia)}` satisfies `route.${Kebab<MeasuredVia>}`;
  return bound(c) ? 'route.unresolved.identifier-bound' : 'route.unresolved.nothing-bound';
}

function idParams(c: ResolvedComponent): LineageParams {
  return {
    ...componentIdParams(c),
    ...(c.athyg === null ? {} : { athyg: sourceRowRefText(c.athyg.value.ref) }),
  };
}

export function* astrometryLineageRows(result: Pick<Stage3Result, 'pairs' | 'astrometry' | 'siblingClaimed'>): Generator<LineageRow> {
  const rowOf = new Map<ResolvedComponent, string>();
  for (const p of result.pairs) {
    const a = result.astrometry.get(p)!;
    for (const [c, side] of [[p.primary, a.primary], [p.secondary, a.secondary]] as const) {
      const key = componentRowKey(p.pair, c.component);
      rowOf.set(c, key);
      const evidence = side.astrometryVia === 'unresolved' ? [] : [sourceRowRefText(side.from)];
      yield stageRow(ASTROMETRY_CODES, key, routeBranch(c, side), idParams(c), evidence);
    }
  }
  for (const s of result.siblingClaimed) {
    yield stageRow(ASTROMETRY_CODES, rowOf.get(s.component)!, 'refused.athyg-match-sibling-claimed', { hip: hipDesignation(s.hip) }, []);
  }
}

export function astrometryLineageLines(result: Pick<Stage3Result, 'pairs' | 'astrometry' | 'siblingClaimed'>): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of astrometryLineageRows(result)) lines.push(stageLineageLine(ASTROMETRY_CODES, row));
  return lines;
}

/** The `astrometry_*` count-snapshot keys, one per route, from the stage's lines: both unresolved codes count as `unresolved`. */
export type AstrometryCounts = Record<`astrometry_${RoutedVia}`, number>;

export function astrometryCounts(lines: readonly LineageLine[]): AstrometryCounts {
  const perCode = foldStageLines(ASTROMETRY_CODES, lines);
  const count = (branch: Exclude<AstrometryBranch, 'refused.athyg-match-sibling-claimed'>): number => perCode[ASTROMETRY_CODES.liveCode(branch)];
  const counts = Object.fromEntries(MEASURED_VIA.map((via) => [`astrometry_${via}`, count(`route.${kebab(via)}`)])) as Record<`astrometry_${MeasuredVia}`, number>;
  return { ...counts, astrometry_unresolved: count('route.unresolved.nothing-bound') + count('route.unresolved.identifier-bound') };
}

function unresolvedRows(what: string, rows: readonly (readonly [string, string, string])[]): [string, string][] {
  return rows.map(([wdsId, components, comp]) => [componentRowKey({ wdsId, components }, comp), what]);
}

export const ASTROMETRY_INVARIANTS: readonly LineageInvariant[] = [
  namedExceptionsInvariant(
    ASTROMETRY_CODES, 'route.unresolved.identifier-bound',
    'every component that binds a Gaia source, a HIP or an AT-HYG row gets astrometry, but the rows named',
    new Map([
      ...unresolvedRows('binds a HIP that HIP2 does not carry, with no Gaia source and no AT-HYG match', [
        ['06323+5225', 'AB', 'A'], ['06393-3150', 'A,BC', 'BC'], ['07113-2148', 'A,BC', 'BC'], ['07322+1405', 'AB', 'A'],
        ['08075-1212', 'AB', 'A'], ['09393-1013', 'AB', 'A'], ['16413+3006', 'AB', 'A'], ['18072-1854', 'A,BC', 'BC'],
      ]),
      ...unresolvedRows('binds an AT-HYG row whose position match the sibling guard refused: another letter binds its HIP', [
        ['06096+0540', 'AB', 'B'], ['06460-6624', 'CD', 'D'], ['14040-4437', 'AC', 'A'],
      ]),
      ...unresolvedRows('Sirius B: binds a Gaia source the astrometry pull does not carry', [['06451-1643', 'AB', 'B']]),
    ]),
  ),
];
