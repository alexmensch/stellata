// build:classic-ids as a lineage stage: its reason codes, one row per designation it reads, and its two gate queues as views. See README.md#classic-id-lineage.

import { lineageInvariant, NO_EXCEPTIONS, type LineageInvariant } from '../lineage/lineage-invariant-pure';
import { paramsOf, stageRow, type LineageParams, type LineageRow } from '../lineage/lineage-row-pure';
import { outcomeCode, refusalCode, stageCodes } from '../lineage/reason-codes/reason-codes-pure';
import type { GateReason } from '../membership/binding/binding-gate-pure';
import { PRINTED_V_TIERS, type PrintedVVia } from '../photometry/v-magnitude-pure';
import { OVERLAY_VALUE_SEPARATOR, type DesignationReach, type GateRefusal, type RouteCheck } from './classic-id-overlay-pure';
import type { RejectedBindingRow } from './rejected-bindings-tsv';
import type { HdHipRouteDisagreement } from './route-disagreements-tsv';
import { CLASSIC_IDS_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

/** The snapshot's one stage; its `-derived` slot holds the counts no row decides. */
export const CLASSIC_ID_COUNT_STAGES = [CLASSIC_IDS_LINEAGE.stage] as const;

export const CLASSIC_ID_LINEAGE_BUDGET = { gzipBytes: 9_800_000, writeMs: 10_000 };

const KEPT = 'and the binding gate keeps at least one.';
const REFUSED = 'and the binding gate refuses every one.';

export const CLASSIC_ID_CODES = stageCodes(CLASSIC_IDS_LINEAGE.stage, {
  'hd.bound': outcomeCode(`The HD's IV/25 Tycho-2 entries reach Gaia sources through the Gaia TYC cross-match, ${KEPT}`),
  'hd.gated': outcomeCode(`The HD's IV/25 Tycho-2 entries reach Gaia sources through the Gaia TYC cross-match, ${REFUSED}`),
  'hd.no-source': outcomeCode('None of the HD\'s IV/25 Tycho-2 entries is in the Gaia TYC cross-match.'),
  'hip.bound': outcomeCode('The Gaia HIP cross-match pairs the HIP with a source the binding gate keeps.'),
  'hip.gated': outcomeCode('The Gaia HIP cross-match pairs the HIP with a source the binding gate refuses.'),
  'bayer.hd-route.bound': outcomeCode(`The Bayer designation reaches Gaia sources through its IV/27A HD, ${KEPT}`),
  'bayer.hd-route.gated': outcomeCode(`The Bayer designation reaches Gaia sources through its IV/27A HD, ${REFUSED}`),
  'bayer.hip-route.bound': outcomeCode(`The Bayer designation's IV/27A HD reaches no Gaia source and its HIP reaches one, ${KEPT}`),
  'bayer.hip-route.gated': outcomeCode(`The Bayer designation's IV/27A HD reaches no Gaia source and its HIP reaches one, ${REFUSED}`),
  'bayer.no-source': outcomeCode('Neither the Bayer designation\'s IV/27A HD nor its HIP reaches a Gaia source.'),
  'flamsteed.hd-route.bound': outcomeCode(`The Flamsteed designation reaches Gaia sources through its IV/27A HD, ${KEPT}`),
  'flamsteed.hd-route.gated': outcomeCode(`The Flamsteed designation reaches Gaia sources through its IV/27A HD, ${REFUSED}`),
  'flamsteed.hip-route.bound': outcomeCode(`The Flamsteed designation's IV/27A HD reaches no Gaia source and its HIP reaches one, ${KEPT}`),
  'flamsteed.hip-route.gated': outcomeCode(`The Flamsteed designation's IV/27A HD reaches no Gaia source and its HIP reaches one, ${REFUSED}`),
  'flamsteed.no-source': outcomeCode('Neither the Flamsteed designation\'s IV/27A HD nor its HIP reaches a Gaia source.'),
  'hr.bound': outcomeCode(`The HR reaches Gaia sources through its V/50 HD, ${KEPT}`),
  'hr.gated': outcomeCode(`The HR reaches Gaia sources through its V/50 HD, ${REFUSED}`),
  'hr.no-source': outcomeCode('The HR\'s V/50 HD reaches no Gaia source.'),
  'hr.no-hd': outcomeCode('V/50 prints no HD for the HR, so no route reaches a Gaia source.'),
  'gj.edr3.bound': outcomeCode('CNS5 states the GJ designation\'s Gaia source, and the binding gate keeps it.'),
  'gj.edr3.gated': outcomeCode('CNS5 states the GJ designation\'s Gaia source, and the binding gate refuses it.'),
  'gj.hip-route.bound': outcomeCode('CNS5 states no Gaia source for the GJ designation and its HIP reaches one, and the binding gate keeps it.'),
  'gj.hip-route.gated': outcomeCode('CNS5 states no Gaia source for the GJ designation and its HIP reaches one, and the binding gate refuses it.'),
  'gj.no-source': outcomeCode('CNS5 states no Gaia source for the GJ designation, and no HIP of its reaches one.'),
  'route.agree': outcomeCode('The IV/27A row\'s HD route and HIP route reach the same Gaia source.'),
  'route.disagree': outcomeCode('The IV/27A row\'s HD route and HIP route reach different Gaia sources; the HD route keeps its designations and the row is queued for review.'),
  'route.hip-only': outcomeCode('The IV/27A row\'s HD reaches no Gaia source and its HIP reaches one, so the HIP route carries its designations.'),
  'gate-mag': refusalCode('A Gaia source the designation reached, refused because its G is more than a magnitude fainter than the printed V.'),
  'gate-sibling': refusalCode('A Gaia source the designation reached, refused because SIMBAD gives it to a different component of the system the HIP names.'),
  'unweighed-no-pulled-row': outcomeCode('A Gaia source the designation reached, passed unweighed because the astrometry pull holds no row for it.'),
});

type Branch = Parameters<typeof CLASSIC_ID_CODES.code>[0];
type GateBranch = `gate-${GateReason}`;
type RouteBranch = `route.${RouteCheck['outcome']}`;
type DesignationKind = DesignationReach['kind'];
type DesignationBranch = Exclude<Branch, GateBranch | RouteBranch | 'unweighed-no-pulled-row'>;

/** Each designation row's own params: the designation in the form trace matches, and the cells its route read. */
interface DesignationParams {
  hd: { hd: string };
  hip: { hip: string };
  bayer: { bayer: string; hd: string; hip?: string };
  flamsteed: { flamsteed: string; hd: string; hip?: string };
  hr: { hr: string; hd?: string };
  gj: { gj: string; hip?: string };
}
type KindOf<B extends DesignationBranch> = B extends `${infer K extends DesignationKind}.${string}` ? K : never;
type BranchOf<K extends DesignationKind> = Extract<DesignationBranch, `${K}.${string}`>;

/** A source a designation reached, named by that designation: a key can state two (two HDs on one Tycho-2 id). */
type ReachedParams = { source_id: string; via: string; kind: DesignationKind; designation: string };
/** The gate's facts on a refused source: the same on every row refusing it. */
type RefusedParams = ReachedParams & { hip?: string; v_mag?: string; v_via?: string; g_mag?: string };

/** Each code's params, the one declaration its writer and its views share. */
type ParamsOf<B extends Branch> =
  B extends GateBranch ? RefusedParams
  : B extends 'unweighed-no-pulled-row' ? ReachedParams
  : B extends RouteBranch ? { hd: string; hip: string; hd_route_source_ids?: string; hip_route_source_id: string }
  : B extends DesignationBranch ? DesignationParams[KindOf<B>] & (B extends `${string}.bound` ? { source_ids: string } : unknown)
  : never;

export const CLASSIC_ID_INVARIANTS: readonly LineageInvariant[] = [
  lineageInvariant(
    CLASSIC_ID_CODES,
    'unweighed-no-pulled-row',
    'every source a designation reaches is weighed on a row the astrometry pull carries (README.md#the-gates-evidence-has-to-be-pulled)',
    NO_EXCEPTIONS,
  ),
];

/** Each source a designation row cites, keyed by its declaration: the build and the unit suite share one. */
export interface ClassicIdKeys {
  readonly iv25: (tyc: string) => string;
  readonly hipXmatch: (hip: number) => string;
  readonly iv27a: (hd: number) => string;
  readonly v50: (hr: number) => string;
  readonly cns5: (cns5: number) => string;
}

function row<B extends Branch>(key: string, branch: B, params: ParamsOf<B>, evidence: readonly string[] = []): LineageRow {
  return stageRow(CLASSIC_ID_CODES, key, branch, params as LineageParams, evidence);
}

function paramsAs<B extends Branch>(r: LineageRow, branch: B): ParamsOf<B> {
  if (r.code !== CLASSIC_ID_CODES.code(branch)) throw new Error(`${r.key}: ${r.code} read as ${branch}`);
  return paramsOf(r) as ParamsOf<B>;
}

const hdText = (hd: number): string => `hd:${hd}`;
const hipText = (hip: number): string => `hip:${hip}`;
const optionalHip = (hip: number | null): { hip?: string } => (hip === null ? {} : { hip: hipText(hip) });

/** The number in a designation param written by `hdText` / `hipText` / the `hr` form. */
function designationNumber(value: string, ns: 'hd' | 'hip' | 'hr'): number {
  const prefix = `${ns}:`;
  const n = Number(value.slice(prefix.length));
  if (!value.startsWith(prefix) || !Number.isInteger(n)) throw new Error(`classic-ids lineage: "${value}" is not a ${ns} designation`);
  return n;
}

interface Designation<K extends DesignationKind> {
  readonly key: string;
  readonly evidence: readonly string[];
  /** The designation as `params` states it, in the form trace matches. */
  readonly designation: string;
  readonly params: DesignationParams[K];
}

/** A reach's row: its outcome against the sources the gate kept, and the route that carried it. */
function designationRow(r: DesignationReach, refused: ReadonlyMap<string, GateRefusal>, keys: ClassicIdKeys): {
  readonly key: string;
  readonly row: LineageRow;
  readonly via: string;
  readonly sources: readonly string[];
  readonly designation: string;
} {
  const designated = <K extends DesignationKind>(d: Designation<K>, branch: BranchOf<K>, params: LineageParams) => (
    stageRow(CLASSIC_ID_CODES, d.key, branch, params, d.evidence)
  );
  const outcome = <K extends DesignationKind>(
    d: Designation<K>, via: string, sources: readonly string[], bound: BranchOf<K>, gated: BranchOf<K>,
  ) => {
    const kept = sources.filter((s) => !refused.has(s));
    const built = kept.length > 0
      ? designated(d, bound, { ...d.params as LineageParams, source_ids: kept.join(OVERLAY_VALUE_SEPARATOR) })
      : designated(d, gated, d.params as LineageParams);
    return { key: d.key, row: built, via, sources, designation: d.designation };
  };
  const none = <K extends DesignationKind>(d: Designation<K>, branch: BranchOf<K>) => (
    { key: d.key, row: designated(d, branch, d.params as LineageParams), via: '', sources: [], designation: d.designation }
  );
  switch (r.kind) {
    case 'hd': {
      const [anchor, ...rest] = [...r.tycs].sort();
      const hd = hdText(r.hd);
      const d = { key: keys.iv25(anchor), evidence: rest.map(keys.iv25), designation: hd, params: { hd } };
      return r.reach.kind === 'reached'
        ? outcome(d, r.reach.route, r.reach.sources, 'hd.bound', 'hd.gated')
        : none(d, 'hd.no-source');
    }
    case 'hip': {
      const hip = hipText(r.hip);
      return outcome(
        { key: keys.hipXmatch(r.hip), evidence: [], designation: hip, params: { hip } }, 'xmatch', [r.source], 'hip.bound', 'hip.gated',
      );
    }
    case 'bayer': {
      const d = { key: keys.iv27a(r.hd), evidence: [], designation: r.value, params: { bayer: r.value, hd: hdText(r.hd), ...optionalHip(r.hip) } };
      if (r.reach.kind === 'unreached') return none(d, 'bayer.no-source');
      return r.reach.route === 'hd'
        ? outcome(d, 'hd', r.reach.sources, 'bayer.hd-route.bound', 'bayer.hd-route.gated')
        : outcome(d, 'hip', r.reach.sources, 'bayer.hip-route.bound', 'bayer.hip-route.gated');
    }
    case 'flamsteed': {
      const d = { key: keys.iv27a(r.hd), evidence: [], designation: r.value, params: { flamsteed: r.value, hd: hdText(r.hd), ...optionalHip(r.hip) } };
      if (r.reach.kind === 'unreached') return none(d, 'flamsteed.no-source');
      return r.reach.route === 'hd'
        ? outcome(d, 'hd', r.reach.sources, 'flamsteed.hd-route.bound', 'flamsteed.hd-route.gated')
        : outcome(d, 'hip', r.reach.sources, 'flamsteed.hip-route.bound', 'flamsteed.hip-route.gated');
    }
    case 'hr': {
      const hr = `hr:${r.hr}`;
      const d = { key: keys.v50(r.hr), evidence: [], designation: hr, params: { hr, ...(r.hd === null ? {} : { hd: hdText(r.hd) }) } };
      if (r.reach.kind === 'reached') return outcome(d, r.reach.route, r.reach.sources, 'hr.bound', 'hr.gated');
      return none(d, r.hd === null ? 'hr.no-hd' : 'hr.no-source');
    }
    case 'gj': {
      const d = { key: keys.cns5(r.cns5), evidence: [], designation: r.gj, params: { gj: r.gj, ...optionalHip(r.hip) } };
      if (r.reach.kind === 'unreached') return none(d, 'gj.no-source');
      return r.reach.route === 'edr3'
        ? outcome(d, 'edr3', r.reach.sources, 'gj.edr3.bound', 'gj.edr3.gated')
        : outcome(d, 'hip', r.reach.sources, 'gj.hip-route.bound', 'gj.hip-route.gated');
    }
    default: {
      const unhandled: never = r;
      throw new Error(`classic-ids lineage: no row mapping for ${JSON.stringify(unhandled)}`);
    }
  }
}

function refusedRow(key: string, reached: ReachedParams, r: GateRefusal): LineageRow {
  const params: RefusedParams = { ...reached };
  if (r.hip !== null) params.hip = String(r.hip);
  if (r.printedV !== null) {
    params.v_mag = String(r.printedV.vMag);
    params.v_via = r.printedV.vVia;
  }
  if (r.gMag !== null) params.g_mag = String(r.gMag);
  return row(key, `gate-${r.reason}`, params);
}

/** One outcome row per designation the join reads, one per IV/27A route check, and one refused or unweighed row per gated or unpulled source each designation reached. */
export function classicIdLineage(
  { reaches, routeChecks, refused, unpulled }: {
    readonly reaches: readonly DesignationReach[];
    readonly routeChecks: readonly RouteCheck[];
    readonly refused: readonly GateRefusal[];
    readonly unpulled: ReadonlySet<string>;
  },
  keys: ClassicIdKeys,
): LineageRow[] {
  const refusals = new Map(refused.map((r) => [r.sourceId, r]));
  const rows: LineageRow[] = [];
  for (const reach of reaches) {
    const d = designationRow(reach, refusals, keys);
    rows.push(d.row);
    for (const s of d.sources) {
      const reached: ReachedParams = { source_id: s, via: d.via, kind: reach.kind, designation: d.designation };
      const refusal = refusals.get(s);
      if (refusal !== undefined) rows.push(refusedRow(d.key, reached, refusal));
      if (unpulled.has(s)) rows.push(row(d.key, 'unweighed-no-pulled-row', reached));
    }
  }
  for (const c of routeChecks) {
    rows.push(row(keys.iv27a(c.hd), `route.${c.outcome}`, {
      hd: hdText(c.hd),
      hip: hipText(c.hip),
      ...(c.hdRouteSourceIds.length === 0 ? {} : { hd_route_source_ids: c.hdRouteSourceIds.join(OVERLAY_VALUE_SEPARATOR) }),
      hip_route_source_id: c.hipRouteSourceId,
    }));
  }
  return rows;
}

/** The text `rejected_bindings.tsv` names a source's designations by, in its fixed order. */
function designationSummary(of: ReadonlyMap<DesignationKind, ReadonlySet<string>>): string {
  const values = (k: DesignationKind): string[] => [...of.get(k) ?? []];
  const numbers = (k: 'hd' | 'hr'): number[] => values(k).map((v) => designationNumber(v, k)).sort((a, b) => a - b);
  const parts: string[] = [];
  const hd = numbers('hd');
  const hr = numbers('hr');
  const gj = values('gj').sort();
  if (hd.length) parts.push(`HD ${hd.join('/')}`);
  if (hr.length) parts.push(`HR ${hr.join('/')}`);
  if (gj.length) parts.push(`GJ ${gj.join('/')}`);
  parts.push(...values('bayer').sort(), ...values('flamsteed').sort());
  return parts.join(' · ');
}

const GATE_BRANCHES = { 'gate-mag': 'mag', 'gate-sibling': 'sibling' } as const satisfies Record<GateBranch, GateReason>;
const refusalBranchOf = new Map<string, readonly [GateBranch, GateReason]>(
  Object.entries(GATE_BRANCHES).map(([b, reason]) => [CLASSIC_ID_CODES.code(b as GateBranch), [b as GateBranch, reason]]),
);

const floatOf = (v: string | undefined): number | null => (v === undefined ? null : Number(v));

function vViaOf(v: string | undefined): PrintedVVia | null {
  if (v === undefined) return null;
  if (!(PRINTED_V_TIERS as readonly string[]).includes(v)) throw new Error(`classic-ids lineage: v_via "${v}" is not a printed tier`);
  return v as PrintedVVia;
}

/** `rejected_bindings.tsv`: the refused rows grouped by source, each named by every designation its rows carry. */
export function rejectedBindingsView(rows: readonly LineageRow[]): RejectedBindingRow[] {
  const bySource = new Map<string, {
    row: Omit<RejectedBindingRow, 'designations'>;
    keys: string[];
    named: Map<DesignationKind, Set<string>>;
  }>();
  for (const r of rows) {
    const refusal = refusalBranchOf.get(r.code);
    if (refusal === undefined) continue;
    const p = paramsAs(r, refusal[0]);
    const facts: Omit<RejectedBindingRow, 'designations'> = {
      sourceId: p.source_id,
      hip: p.hip === undefined ? null : Number(p.hip),
      vMag: floatOf(p.v_mag),
      vVia: vViaOf(p.v_via),
      gMag: floatOf(p.g_mag),
      reason: refusal[1],
    };
    let held = bySource.get(p.source_id);
    if (held === undefined) bySource.set(p.source_id, held = { row: facts, keys: [], named: new Map() });
    else if (JSON.stringify(held.row) !== JSON.stringify(facts)) {
      throw new Error(`classic-ids lineage: ${p.source_id} is refused on different gate facts under ${held.keys[0]} and ${r.key}`);
    }
    held.keys.push(r.key);
    held.named.set(p.kind, (held.named.get(p.kind) ?? new Set()).add(p.designation));
  }
  return [...bySource.values()].map(({ row: facts, named }) => ({ ...facts, designations: designationSummary(named) }));
}

/** `hd_hip_route_disagreements.tsv`: the IV/27A route checks that disagree. */
export function routeDisagreementsView(rows: readonly LineageRow[]): HdHipRouteDisagreement[] {
  const disagree = CLASSIC_ID_CODES.code('route.disagree');
  return rows.filter((r) => r.code === disagree).map((r) => {
    const p = paramsAs(r, 'route.disagree');
    if (p.hd_route_source_ids === undefined) throw new Error(`${r.key}: a disagreeing route check names no HD-route source`);
    return {
      hd: designationNumber(p.hd, 'hd'),
      hip: designationNumber(p.hip, 'hip'),
      hdRouteSourceIds: p.hd_route_source_ids.split(OVERLAY_VALUE_SEPARATOR),
      hipRouteSourceId: p.hip_route_source_id,
    };
  });
}
