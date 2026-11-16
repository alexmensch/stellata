// Stage 2's decisions per WDS component as the resolve lineage stage: its tier, each candidate a cascade gate refused, its part in each audit verdict. See README.md#resolve-lineage.

import {
  foldStageLines, lineageLineCode, lineageLineParams, parseParams, stageLines, stageRow,
  type LineageLine, type LineageParams, type LineageRow,
} from '../../catalog/lineage/lineage-row-pure';
import {
  kebab, outcomeCode, refusalCode, stageCodes, taggedCodes, type CodeDeclaration, type Kebab,
} from '../../catalog/lineage/reason-codes/reason-codes-pure';
import { namedExceptionsInvariant, type LineageInvariant } from '../../catalog/lineage/lineage-invariant-pure';
import { hipDesignation } from '../../sid/sid-pure';
import { RESOLVE_VIA, isReservedResolveVia } from '../multiples-record-pure';
import { componentRowKey as rowKey } from '../multiples-row-key-pure';
import {
  BINDING_SHAPES, BINDING_VERDICTS, VERDICT_PARTS, bindingIntegrityCounts,
  type BindingShape, type BindingVerdictKind, type VerdictPart, type VerdictTouch,
} from './binding-audit-pure';
import { CASCADE_GATES, type CascadeGate } from './cascade-pure';
import { componentSides, resolveViaOf, valueOf, type ResolvedComponent } from './components-pure';
import type { Stage2Result } from './resolve-pairs';
import { RESOLVE_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const RESOLVE_LINEAGE_BUDGET = { gzipBytes: 1_200_000, writeMs: 2_000 };

type BoundTier = ReturnType<typeof resolveViaOf>;
const TIERS = RESOLVE_VIA.filter((v): v is BoundTier => !isReservedResolveVia(v));

const TIER_DESCRIPTIONS: Record<BoundTier, string> = {
  orb6_hip: 'The component\'s Gaia source came through its pair\'s ORB6 HIP and Gaia\'s HIP cross-walk.',
  athyg_gaia_native: 'The component\'s Gaia source is an AT-HYG row\'s own gaia cell, reached through a HIP or a position match.',
  simbad_xid: 'The component\'s Gaia source is SIMBAD\'s per-component cross-ID for it.',
  ccdm_hip: 'The component\'s Gaia source came through a CCDM sibling HIP near its WDS position.',
  unresolved: 'The component has no Gaia source: every tier missed, or the audit unbound it.',
};

const GATE_DESCRIPTIONS: Record<CascadeGate, string> = {
  orb6_hip_off_coord: 'An ORB6 HIP refused before any tier: its position sits over 5′ from the pair\'s WDS coordinate.',
  ccdm_sibling_owned: 'A CCDM sibling HIP refused: another hierarchy-disjoint, non-partner letter of the system owns it, by geometry or by binding.',
  athyg_match_sibling_claimed: 'An AT-HYG position match refused: another hierarchy-disjoint, non-partner letter of the system already binds its HIP.',
};

const SHAPE_TEXT: Record<BindingShape, string> = {
  source_letters: 'One Gaia source bound to hierarchy-disjoint letters',
  letter_sources: 'One letter bound to different Gaia sources on different rows',
};

const VERDICT_TEXT: Record<BindingVerdictKind, string> = {
  geometric: 'arbitrated by WDS pair geometry',
  identity_refuted: 'settled by SIMBAD\'s per-component cross-IDs',
  unbound_ambiguous: 'with no decisive candidate',
  skipped_no_reference: 'left as bound: no uncontested astrometric reference letter',
  skipped_photocentre_blend: 'left as bound: a photocentre blend',
};

const PART_TEXT: Record<VerdictPart, string> = {
  won: 'this component keeps its source.',
  refused: 'this component\'s binding to the source is refused.',
  skipped: 'this component keeps its source unchanged.',
};

type AuditBranch = `audit.${Kebab<BindingShape>}.${Kebab<BindingVerdictKind>}.${VerdictPart}`;

function auditBranch(shape: BindingShape, verdict: BindingVerdictKind, part: VerdictPart): AuditBranch {
  return `audit.${kebab(shape)}.${kebab(verdict)}.${part}`;
}

interface AuditCode {
  readonly shape: BindingShape;
  readonly verdict: BindingVerdictKind;
}

const AUDIT_CODES: ReadonlyMap<AuditBranch, AuditCode> = new Map(BINDING_SHAPES.flatMap((shape) => {
  const parts: Partial<Record<BindingVerdictKind, readonly VerdictPart[]>> = VERDICT_PARTS[shape];
  return BINDING_VERDICTS.flatMap((verdict) => (parts[verdict] ?? []).map(
    (part): [AuditBranch, AuditCode] => [auditBranch(shape, verdict, part), { shape, verdict }],
  ));
}));

function auditDeclaration(branch: AuditBranch): CodeDeclaration {
  const { shape, verdict } = AUDIT_CODES.get(branch)!;
  const part = branch.slice(branch.lastIndexOf('.') + 1) as VerdictPart;
  const description = `${SHAPE_TEXT[shape]}, ${VERDICT_TEXT[verdict]}; ${PART_TEXT[part]}`;
  return part === 'refused' ? refusalCode(description) : outcomeCode(description);
}

export const RESOLVE_CODES = stageCodes(RESOLVE_LINEAGE.stage, {
  ...taggedCodes('tier.', TIERS, (tier) => outcomeCode(TIER_DESCRIPTIONS[tier])),
  ...taggedCodes('refused.', CASCADE_GATES, (gate) => refusalCode(GATE_DESCRIPTIONS[gate])),
  ...Object.fromEntries([...AUDIT_CODES.keys()].map((b) => [b, auditDeclaration(b)])) as Record<AuditBranch, CodeDeclaration>,
});

function tierBranch(via: BoundTier): `tier.${Kebab<BoundTier>}` {
  return `tier.${kebab(via)}`;
}

function touchParams({ verdict, sourceId }: VerdictTouch): LineageParams {
  return {
    wds: verdict.wdsId,
    contested: verdict.contested,
    gaia: sourceId,
    ...(verdict.reference === null ? {} : { reference: verdict.reference.token, reference_gaia: verdict.reference.sourceId }),
    ...(verdict.winner === null ? {} : { winner: verdict.winner.label }),
  };
}

/** A Gaia source bare and a HIP as `hip:`, where bound: the forms trace matches a query on. */
export function idParams(gaia: string | null, hip: number | null): LineageParams {
  return {
    ...(gaia === null ? {} : { gaia }),
    ...(hip === null ? {} : { hip: hipDesignation(hip) }),
  };
}

export function componentIdParams(c: Pick<ResolvedComponent, 'gaia' | 'hip'>): LineageParams {
  return idParams(valueOf(c.gaia), valueOf(c.hip));
}

export function* resolveLineageRows(result: Pick<Stage2Result, 'pairs' | 'refusals' | 'touches'>): Generator<LineageRow> {
  for (const { row, component: c } of componentSides(result.pairs)) {
    yield stageRow(RESOLVE_CODES, rowKey(row, c.component), tierBranch(resolveViaOf(c)), componentIdParams(c), []);
  }
  for (const r of result.refusals) {
    yield stageRow(RESOLVE_CODES, rowKey(r.pair, r.component), `refused.${kebab(r.gate)}`, { hip: hipDesignation(r.hip) }, []);
  }
  for (const t of result.touches) {
    const branch = auditBranch(t.verdict.shape, t.verdict.verdict, t.part);
    yield stageRow(RESOLVE_CODES, rowKey(t.pair, t.component), branch, touchParams(t), []);
  }
}

export function resolveLineageLines(result: Pick<Stage2Result, 'pairs' | 'refusals' | 'touches'>): LineageLine[] {
  return stageLines(RESOLVE_CODES, resolveLineageRows(result));
}

const AUDIT_BY_CODE: ReadonlyMap<string, AuditCode> = new Map(
  [...AUDIT_CODES].map(([branch, code]) => [RESOLVE_CODES.code(branch), code]),
);

/** The count-snapshot keys Stage 2's code alone produces, from the stage's lines: an audit verdict once, however many components it weighed. */
export function resolveCounts(lines: readonly LineageLine[]) {
  const perCode = foldStageLines(RESOLVE_CODES, lines);
  const verdicts = new Map<string, AuditCode>();
  for (const line of lines) {
    const audit = AUDIT_BY_CODE.get(lineageLineCode(line));
    if (audit === undefined) continue;
    const { wds, contested } = parseParams(lineageLineParams(line));
    verdicts.set(`${wds}\t${audit.shape}\t${contested}`, audit);
  }
  return {
    ccdm_sibling_owned_rejected: perCode[RESOLVE_CODES.liveCode('refused.ccdm-sibling-owned')],
    ...bindingIntegrityCounts([...verdicts.values()]),
  };
}

export type ResolveCounts = ReturnType<typeof resolveCounts>;

function conflictRows(wds: string, what: string, rows: readonly (readonly [string, string])[]): [string, string][] {
  return rows.map(([components, comp]) => [rowKey({ wdsId: wds, components }, comp), what]);
}

const AMBIGUOUS_LETTER_SOURCES = new Map([
  ...conflictRows('10444-6000', 'Aa on two Gaia sources, neither decisive against its offset from A', [
    'Aa,Ab', 'Aa,Ac', 'Aa,Ad', 'Aa,E', 'Aa,F', 'Aa,G', 'Aa,H', 'Aa,I', 'Aa,J', 'Aa,K',
    'Aa,L', 'Aa,M', 'Aa,N', 'Aa,O', 'Aa,P', 'Aa,Q', 'Aa,R', 'Aa,S', 'Aa,T', 'Aa,U',
  ].map((components) => [components, 'Aa'] as const)),
  ...conflictRows('20450+1244', 'A on two Gaia sources, neither decisive against its offset from C', [['AB', 'A'], ['AC', 'A'], ['AD', 'A']]),
]);

const AMBIGUOUS_SOURCE_LETTERS = new Map([
  ...conflictRows('13401-6033', 'B and Cb on one Gaia source, neither decisive against its offset from Ca', [
    ['AB', 'B'], ['B,Ca', 'B'], ['Ca,Cb', 'Cb'],
  ]),
  ...conflictRows('20588-0921', 'C and D on one Gaia source, neither decisive against its offset from A', [
    ['AB,C', 'C'], ['CE', 'C'], ['AB,D', 'D'], ['DE', 'D'], ['DF', 'D'],
  ]),
]);

const AMBIGUOUS_HOLDS = 'no component loses its Gaia source to an ambiguous binding-integrity verdict but the rows named';

export const RESOLVE_INVARIANTS: readonly LineageInvariant[] = [
  namedExceptionsInvariant(RESOLVE_CODES, 'audit.letter-sources.unbound-ambiguous.refused', AMBIGUOUS_HOLDS, AMBIGUOUS_LETTER_SOURCES),
  namedExceptionsInvariant(RESOLVE_CODES, 'audit.source-letters.unbound-ambiguous.refused', AMBIGUOUS_HOLDS, AMBIGUOUS_SOURCE_LETTERS),
];
