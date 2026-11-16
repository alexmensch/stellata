// Stage 4's decision per pair as the orbits lineage stage: the orbit source chosen, and each candidate row passed over with its rule. See README.md#orbits-lineage.

import { lineageInvariant, namedExceptionsInvariant, NO_EXCEPTIONS, type LineageInvariant } from '../../catalog/lineage/lineage-invariant-pure';
import { foldStageLines, stageLineageLine, stageRow, type LineageLine, type LineageRow } from '../../catalog/lineage/lineage-row-pure';
import {
  kebab, outcomeCode, refusalCode, stageCodes, taggedCodes, type CodeDeclaration, type Kebab,
} from '../../catalog/lineage/reason-codes/reason-codes-pure';
import { sourceRowRefText } from '../../util/sources/row-ref-pure';
import { ORBIT_VIA, ORBIT_VIA_ON_FILE, type OrbitVia, type OrbitViaOnFile } from '../multiples-record-pure';
import { pairParams } from '../pairs-lineage-pure';
import type { Stage4Result } from './attach-orbits';
import { ORBIT_PASS_RULES, type OrbitPassRule } from './select-orbit-pure';
import { ORBITS_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const ORBITS_LINEAGE_BUDGET = { gzipBytes: 1_300_000, writeMs: 2_000 };

const SOURCE_TEXT: Record<OrbitVia, string> = {
  orb6: 'The pair\'s orbit is its best ORB6 visual row (grades 1-5).',
  gaia_nss: 'The pair\'s orbit is a Gaia DR3 NSS two-body solution of a source on its sides.',
  orb6_spectroscopic: 'The pair\'s orbit is its best ORB6 non-visual row (grades 7-9).',
  msc: 'The pair\'s orbit is its best MSC row, the pair being sub-resolution.',
  none: 'No orbit row on file for the pair yields elements.',
};

const ROUTE_TEXT: Record<OrbitViaOnFile, string> = {
  orb6: 'An ORB6 visual row',
  gaia_nss: 'A Gaia NSS solution',
  orb6_spectroscopic: 'An ORB6 non-visual row',
  msc: 'An MSC row',
};

type AnyPassRule = OrbitPassRule<OrbitViaOnFile>;

const RULE_TEXT: Record<AnyPassRule, string> = {
  outranked: 'outranked by the orbit a higher route chose',
  unreadable: 'converting to no elements (an unreadable period, unit or solution type)',
  partner_distinct_source: 'interior to its side, the pair\'s other side being a different Gaia source',
  out_of_regime: 'outside Gaia\'s astrometric-detectability regime',
  separation_inconsistent: 'too short a period for the pair\'s WDS separation at the system distance',
  measured_separation: 'off a pair with a measured WDS separation',
};

type PassBranch = { [R in OrbitViaOnFile]: `passed.${Kebab<R>}.${Kebab<OrbitPassRule<R>>}` }[OrbitViaOnFile];

function passBranch<R extends OrbitViaOnFile>(route: R, rule: OrbitPassRule<R>): PassBranch {
  return `passed.${kebab(route)}.${kebab(rule)}` as PassBranch;
}

const PASS_CODES = Object.fromEntries(ORBIT_VIA_ON_FILE.flatMap((route) => (ORBIT_PASS_RULES[route] as readonly AnyPassRule[]).map(
  (rule) => [passBranch(route, rule as OrbitPassRule<typeof route>), refusalCode(`${ROUTE_TEXT[route]} passed over: ${RULE_TEXT[rule]}.`)],
))) as Record<PassBranch, CodeDeclaration>;

export const ORBITS_CODES = stageCodes(ORBITS_LINEAGE.stage, {
  ...taggedCodes('source.', ORBIT_VIA, (via) => outcomeCode(SOURCE_TEXT[via])),
  ...PASS_CODES,
});

export function* orbitsLineageRows(result: Stage4Result): Generator<LineageRow> {
  for (const [p, orbit] of result.orbits) {
    const key = sourceRowRefText(p.pair.origin);
    const params = pairParams(p);
    const candidates = result.candidates.get(p)!;
    const chosen = candidates.filter((c) => c.verdict === 'chosen').map((c) => sourceRowRefText(c.from));
    yield stageRow(ORBITS_CODES, key, `source.${kebab(orbit.orbitVia)}`, params, chosen);
    for (const c of candidates) {
      if (c.verdict === 'chosen') continue;
      yield stageRow(ORBITS_CODES, key, passBranch(c.route, c.verdict as OrbitPassRule<typeof c.route>), params, [sourceRowRefText(c.from)]);
    }
  }
}

export function orbitsLineageLines(result: Stage4Result): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of orbitsLineageRows(result)) lines.push(stageLineageLine(ORBITS_CODES, row));
  return lines;
}

/** The `orbit_*` count-snapshot keys, one per source, from the stage's lines. */
export type OrbitsCounts = Record<`orbit_${OrbitVia}`, number>;

export function orbitsCounts(lines: readonly LineageLine[]): OrbitsCounts {
  const perCode = foldStageLines(ORBITS_CODES, lines);
  return Object.fromEntries(ORBIT_VIA.map((via) => [`orbit_${via}`, perCode[ORBITS_CODES.liveCode(`source.${kebab(via)}`)]])) as OrbitsCounts;
}

const UNREADABLE_HOLDS = 'every orbit row the cascade weighs converts to elements, but the rows named';

export const ORBITS_INVARIANTS: readonly LineageInvariant[] = [
  lineageInvariant(ORBITS_CODES, 'passed.orb6.unreadable', UNREADABLE_HOLDS, NO_EXCEPTIONS),
  lineageInvariant(ORBITS_CODES, 'passed.gaia-nss.unreadable', UNREADABLE_HOLDS, NO_EXCEPTIONS),
  namedExceptionsInvariant(ORBITS_CODES, 'passed.orb6-spectroscopic.unreadable', UNREADABLE_HOLDS, new Map([
    ['wds:02556+2652/STF 326/AB', 'STF 326 AB\'s ORB6 row states no period'],
    ['wds:15567-4219/BIL   5/', 'BIL 5\'s ORB6 row states no period'],
  ])),
  lineageInvariant(ORBITS_CODES, 'passed.msc.unreadable', UNREADABLE_HOLDS, NO_EXCEPTIONS),
];
