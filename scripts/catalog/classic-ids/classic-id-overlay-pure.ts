// The source_id-keyed classic-ID overlay join and its coverage counts.
// Routes, ambiguity policy and precedence: /docs/catalog-driver.md#2-identifier-sources--frozen-cds-files-not-live-simbad and /docs/catalog-driver.md#4-how-hd-reaches-gaia.
import type { Bsc5Row, Cns5Row, CrossIndexRow, Tyc2HdRow } from './classic-ids-parse';
import type { HdHipRouteDisagreement } from './route-disagreements-tsv';
import {
  rejectionOf,
  weighBinding,
  type BindingEvidence,
  type GateReason,
} from '../membership/binding/binding-gate-pure';
import { emptyTallyPartition } from '../../util/counts/tally-pure';
import {
  PRINTED_V_TIERS,
  printedV,
  type PrintedV,
  type PrintedVKeys,
  type PrintedVLookups,
  type PrintedVVia,
} from '../photometry/v-magnitude-pure';

/** No cell is single-valued by construction: a designation naming a
 *  catalogue granularity rather than one object attaches to every matching
 *  record, and a record can carry several. */
export const OVERLAY_VALUE_SEPARATOR = '|';

/** Every classic designation the frozen joins attach to one Gaia DR3
 *  source. `gj` is a bare CNS5 number with its component letter appended
 *  ("551C"); `bayer` / `flamsteed` carry IV/27A's constellation
 *  ("alf Lyr", "3 Lyr"). Each list is sorted and deduplicated. */
export interface OverlayEntry {
  hd: number[];
  hr: number[];
  hip: number[];
  gj: string[];
  bayer: string[];
  flamsteed: string[];
}

export type ClassicIdOverlay = Map<string, OverlayEntry>;

/** The frozen tables and cross-walks the join reads — no gate evidence. */
export interface OverlayWalks {
  tyc2Hd: readonly Tyc2HdRow[];
  crossIndex: readonly CrossIndexRow[];
  bsc5: readonly Bsc5Row[];
  cns5: readonly Cns5Row[];
  tycToSource: ReadonlyMap<string, string>;
  hipToSource: ReadonlyMap<number, string>;
}

export interface OverlayInput extends OverlayWalks {
  evidence: BindingEvidence;
}

/** An overlay row dropped because the source_id it keys is not the star its
 *  designations name. Emitted to `data/classic-ids/rejected_bindings.tsv` so
 *  the parity ledger can review what the gate removed. */
export interface RejectedBinding {
  sourceId: string;
  /** Null where the row carries no HIP at all. */
  hip: number | null;
  /** Null on a sibling refusal of a row no printed tier reaches. Its tier says
   *  whether a rejection rests on Hipparcos or on one of the tiers below it. */
  printedV: PrintedV | null;
  gMag: number | null;
  reason: GateReason;
  designations: string;
}

function designationSummary(entry: OverlayEntry): string {
  const parts: string[] = [];
  if (entry.hd.length) parts.push(`HD ${entry.hd.join('/')}`);
  if (entry.hr.length) parts.push(`HR ${entry.hr.join('/')}`);
  if (entry.gj.length) parts.push(`GJ ${entry.gj.join('/')}`);
  for (const b of entry.bayer) parts.push(b);
  for (const f of entry.flamsteed) parts.push(f);
  return parts.join(' · ');
}

function gateKeys(
  sourceId: string, entry: OverlayEntry, tycsBySource: ReadonlyMap<string, readonly string[]>,
): PrintedVKeys {
  return { printed_hip: entry.hip, tycho2: tycsBySource.get(sourceId) ?? [], gliese: entry.gj };
}

/** Weighs every overlay row through `weighBinding`, the derivation's own
 *  gates. Dropping the WHOLE row rather than just its `hip` cell is the point:
 *  both walks routinely land on the same wrong source, so if the source is not
 *  the star then every designation keyed on it is misattributed, and the
 *  labels ride the inherited spine instead.
 *
 *  An unweighable row binds rather than drops, so the two no-G counts are the
 *  gate's own coverage alarms, split by cause
 *  (`../astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise`;
 *  `../photometry/README.md#the-v-cascade`). */
export function applyBindingGate(
  overlay: ClassicIdOverlay,
  evidence: BindingEvidence,
  tycsBySource: ReadonlyMap<string, readonly string[]>,
): {
  rejected: RejectedBinding[];
  skippedNoPrintedV: number;
  skippedNoGMag: number;
  skippedNullGMag: number;
  gateableVia: Record<PrintedVVia, number>;
  /** The sources the magnitude arm reached a printed V for — what the
   *  astrometry request has to carry a G for. */
  magnitudeWeighed: Set<string>;
} {
  const rejected: RejectedBinding[] = [];
  const magnitudeWeighed = new Set<string>();
  let skippedNoPrintedV = 0;
  let skippedNoGMag = 0;
  let skippedNullGMag = 0;
  const gateableVia = emptyTallyPartition(PRINTED_V_TIERS);
  for (const [sourceId, entry] of overlay) {
    const printed = printedV(gateKeys(sourceId, entry, tycsBySource), evidence.printedV);
    if (printed !== null) gateableVia[printed.vVia]++;
    // The sibling gate keys on a HIP rather than on the V: the one the V came
    // from, else the entry's first.
    const hip = printed?.vVia === 'printed_hip' ? printed.key : entry.hip[0] ?? null;
    const verdict = weighBinding(sourceId, { hip, printedV: printed }, evidence);
    if (verdict.magnitude !== 'no_printed_v') magnitudeWeighed.add(sourceId);
    if (verdict.magnitude === 'no_printed_v') skippedNoPrintedV++;
    else if (verdict.magnitude === 'null_g') skippedNullGMag++;
    else if (verdict.magnitude === 'no_pulled_row') skippedNoGMag++;
    const reason = rejectionOf(verdict);
    if (reason === null) continue;
    rejected.push({
      sourceId,
      hip,
      printedV: printed,
      gMag: evidence.gMagOf(sourceId),
      reason,
      designations: designationSummary(entry),
    });
  }
  for (const r of rejected) overlay.delete(r.sourceId);
  return { rejected, skippedNoPrintedV, skippedNoGMag, skippedNullGMag, gateableVia, magnitudeWeighed };
}

/** An IV/27A row whose HD→TYC→source_id route and HIP→source_id route
 *  disagree. The HD route is the authority (/docs/catalog-driver.md#4-how-hd-reaches-gaia); these go to the parity
 *  ledger's review queue rather than being resolved mechanically. */

export interface OverlayJoinCounts {
  tyc2HdRows: number;
  tyc2HdDistinctTyc: number;
  /** IV/25 rows flagged ambiguous upstream (n_HD > 1 or n_TYC > 1). */
  tyc2HdAmbiguousRows: number;
  tycResolvedToSource: number;
  tycUnresolved: number;
  crossIndexRows: number;
  bsc5Rows: number;
  cns5Rows: number;
  hipXmatchEntries: number;

  overlayRows: number;
  overlayHd: number;
  overlayHr: number;
  overlayHip: number;
  overlayGj: number;
  overlayBayer: number;
  overlayFlamsteed: number;

  sourcesWithMultipleHd: number;
  sourcesWithMultipleHr: number;
  sourcesWithMultipleGj: number;
  sourcesWithMultipleBayer: number;
  sourcesWithMultipleFlamsteed: number;
  hdOnMultipleSources: number;

  /** Rows the binding gate dropped, split by which gate fired, plus the rows
   *  it could not evaluate for want of a printed V under any HIP they carry.
   *  Every `overlay*` count above is post-gate — it describes the artifact.
   *  `reason` is the FIRST gate that fired, so the two rejection counts trade
   *  rows between themselves as `G` coverage changes and only their sum is a
   *  queue size (README.md#the-gates-evidence-has-to-be-pulled). */
  gateRejectedMag: number;
  gateRejectedSibling: number;
  gateSkippedNoPrintedV: number;
  gateableVia: Record<PrintedVVia, number>;
  /** Gateable rows the astrometry pull returned no row for — silently accepted,
   *  not refused. Pinned at zero: the request is a union precisely so that this
   *  stays empty, and a non-zero value is the pull under-covering the
   *  candidate set. */
  gateSkippedNoGMag: number;
  /** Gateable rows Gaia has a row but no `phot_g_mean_mag` for. Also silently
   *  accepted, but no request can fix it — the residual the gate's reach simply
   *  does not cover. */
  gateSkippedNullGMag: number;

  hdHipRouteAgree: number;
  hdHipRouteDisagree: number;
  /** IV/27A rows whose HIP resolves but whose HD reaches no source_id — the
   *  HIP route is the only one that keys them. */
  hdHipRouteHipOnly: number;

  /** Upstream designations no route keys to a source_id. They are not lost
   *  records: their labels ride the inherited spine (/docs/catalog-driver.md#1-the-driver-model), which is why the
   *  overlay is a union term rather than the label authority. */
  crossIndexBayerUnkeyed: number;
  crossIndexFlamsteedUnkeyed: number;
  bsc5HrUnkeyed: number;
  cns5GjUnkeyed: number;
  cns5GjViaHip: number;
}

export interface OverlayJoin {
  overlay: ClassicIdOverlay;
  counts: OverlayJoinCounts;
  disagreements: HdHipRouteDisagreement[];
  rejectedBindings: RejectedBinding[];
}

function entryFor(overlay: ClassicIdOverlay, sourceId: string): OverlayEntry {
  let entry = overlay.get(sourceId);
  if (!entry) {
    entry = { hd: [], hr: [], hip: [], gj: [], bayer: [], flamsteed: [] };
    overlay.set(sourceId, entry);
  }
  return entry;
}

function addValue<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

/** The overlay's counts that describe upstream reachability: what the routes
 *  reach before any gate weighs a row. */
type OverlayRouteCounts = Pick<OverlayJoinCounts,
  | 'tyc2HdRows' | 'tyc2HdDistinctTyc' | 'tyc2HdAmbiguousRows' | 'tycResolvedToSource'
  | 'tycUnresolved' | 'crossIndexRows' | 'bsc5Rows' | 'cns5Rows' | 'hipXmatchEntries'
  | 'hdHipRouteAgree' | 'hdHipRouteDisagree' | 'hdHipRouteHipOnly'
  | 'crossIndexBayerUnkeyed' | 'crossIndexFlamsteedUnkeyed' | 'bsc5HrUnkeyed'
  | 'cns5GjUnkeyed' | 'cns5GjViaHip'>;

/** The sources a designation's route reached before the gate, or none. */
export type Reach<R extends string> =
  | { readonly kind: 'reached'; readonly route: R; readonly sources: readonly string[] }
  | { readonly kind: 'unreached' };

/** One designation the join reads, and where its route took it: the overlay
 *  and its counts are projections of these. */
export type DesignationReach =
  | { readonly kind: 'hd'; readonly hd: number; readonly tycs: readonly string[]; readonly reach: Reach<'tyc'> }
  | { readonly kind: 'hip'; readonly hip: number; readonly source: string }
  | {
    readonly kind: 'bayer' | 'flamsteed';
    readonly hd: number;
    readonly hip: number | null;
    readonly value: string;
    readonly reach: Reach<'hd' | 'hip'>;
  }
  | { readonly kind: 'hr'; readonly hr: number; readonly hd: number | null; readonly reach: Reach<'hd'> }
  | {
    readonly kind: 'gj';
    readonly cns5: number;
    readonly gj: string;
    readonly hip: number | null;
    readonly reach: Reach<'edr3' | 'hip'>;
  };

/** An IV/27A row whose HIP resolves, its HD route weighed against its HIP
 *  route; `hip-only` where the HD reaches no source. */
export type RouteCheck = HdHipRouteDisagreement & { readonly outcome: 'agree' | 'disagree' | 'hip-only' };

/** Every source a route proposes, with the designations each would carry —
 *  the gate's candidates, before any evidence weighs them. */
export interface OverlayCandidates {
  overlay: ClassicIdOverlay;
  /** The Tycho entries IV/25 routes to each source, for the gate's Tycho-2 V
   *  tier: the walk holds both ends here and the overlay carries no TYC cell. */
  tycsBySource: Map<string, string[]>;
  hdToSources: Map<number, string[]>;
  reaches: DesignationReach[];
  routeChecks: RouteCheck[];
  routeCounts: OverlayRouteCounts;
}

function reachOf<R extends string>(route: R, sources: readonly string[]): Reach<R> {
  return sources.length === 0 ? { kind: 'unreached' } : { kind: 'reached', route, sources };
}

function overlayOf(reaches: readonly DesignationReach[]): ClassicIdOverlay {
  const overlay: ClassicIdOverlay = new Map();
  const sourcesOf = (r: { readonly reach: Reach<string> }): readonly string[] => (
    r.reach.kind === 'reached' ? r.reach.sources : []
  );
  for (const r of reaches) {
    switch (r.kind) {
      case 'hd': for (const s of sourcesOf(r)) addValue(entryFor(overlay, s).hd, r.hd); break;
      case 'hip': addValue(entryFor(overlay, r.source).hip, r.hip); break;
      case 'bayer': for (const s of sourcesOf(r)) addValue(entryFor(overlay, s).bayer, r.value); break;
      case 'flamsteed': for (const s of sourcesOf(r)) addValue(entryFor(overlay, s).flamsteed, r.value); break;
      case 'hr': for (const s of sourcesOf(r)) addValue(entryFor(overlay, s).hr, r.hr); break;
      case 'gj':
        for (const s of sourcesOf(r)) {
          const entry = entryFor(overlay, s);
          addValue(entry.gj, r.gj);
          if (r.hip !== null) addValue(entry.hip, r.hip);
        }
        break;
      default: {
        const unhandled: never = r;
        throw new Error(`classic-ID join: unhandled designation ${JSON.stringify(unhandled)}`);
      }
    }
  }
  for (const entry of overlay.values()) {
    entry.hd.sort((a, b) => a - b);
    entry.hr.sort((a, b) => a - b);
    entry.hip.sort((a, b) => a - b);
    entry.gj.sort();
    entry.bayer.sort();
    entry.flamsteed.sort();
  }
  return overlay;
}

function unreached(reaches: readonly DesignationReach[], kind: DesignationReach['kind']): number {
  return reaches.filter((r) => r.kind === kind && 'reach' in r && r.reach.kind === 'unreached').length;
}

export function joinOverlayCandidates(walks: OverlayWalks): OverlayCandidates {
  const { tyc2Hd, crossIndex, bsc5, cns5, tycToSource, hipToSource } = walks;
  const reaches: DesignationReach[] = [];

  // HD → TYC → source_id is the primary route: every HD-bearing AT-HYG row
  // also carries a TYC, so no HD needs the HIP route as an authority.
  const hdToSources = new Map<number, string[]>();
  const tycsByHd = new Map<number, string[]>();
  const tycsBySource = new Map<string, string[]>();
  const distinctTyc = new Set<string>();
  const resolvedTyc = new Set<string>();
  let ambiguousRows = 0;
  for (const row of tyc2Hd) {
    distinctTyc.add(row.tyc);
    if (row.nHd > 1 || row.nTyc > 1) ambiguousRows++;
    const tycsOfHd = tycsByHd.get(row.hd);
    if (tycsOfHd === undefined) tycsByHd.set(row.hd, [row.tyc]);
    else addValue(tycsOfHd, row.tyc);
    const sourceId = tycToSource.get(row.tyc);
    if (sourceId === undefined) continue;
    resolvedTyc.add(row.tyc);
    const tycs = tycsBySource.get(sourceId);
    if (tycs === undefined) tycsBySource.set(sourceId, [row.tyc]);
    else addValue(tycs, row.tyc);
    const sources = hdToSources.get(row.hd);
    if (sources === undefined) hdToSources.set(row.hd, [sourceId]);
    else addValue(sources, sourceId);
  }
  for (const [hd, tycs] of tycsByHd) {
    reaches.push({ kind: 'hd', hd, tycs, reach: reachOf('tyc', hdToSources.get(hd) ?? []) });
  }

  // HIP is a designation in its own right, so every cross-walk entry keys a
  // label — the walk is not merely a routing table here.
  for (const [hip, source] of hipToSource) reaches.push({ kind: 'hip', hip, source });

  const routeChecks: RouteCheck[] = [];
  for (const row of crossIndex) {
    const hdRoute = hdToSources.get(row.hd) ?? [];
    const hipRoute = row.hip === null ? undefined : hipToSource.get(row.hip);
    if (row.hip !== null && hipRoute !== undefined) {
      routeChecks.push({
        hd: row.hd,
        hip: row.hip,
        hdRouteSourceIds: [...hdRoute],
        hipRouteSourceId: hipRoute,
        outcome: hdRoute.length === 0 ? 'hip-only' : hdRoute.includes(hipRoute) ? 'agree' : 'disagree',
      });
    }
    const reach: Reach<'hd' | 'hip'> = hdRoute.length > 0
      ? reachOf('hd', hdRoute)
      : reachOf('hip', hipRoute === undefined ? [] : [hipRoute]);
    if (row.cst === null) continue;
    if (row.bayer !== null) reaches.push({ kind: 'bayer', hd: row.hd, hip: row.hip, value: `${row.bayer} ${row.cst}`, reach });
    if (row.flamsteed !== null) {
      reaches.push({ kind: 'flamsteed', hd: row.hd, hip: row.hip, value: `${row.flamsteed} ${row.cst}`, reach });
    }
  }

  for (const row of bsc5) {
    reaches.push({
      kind: 'hr', hr: row.hr, hd: row.hd, reach: reachOf('hd', row.hd === null ? [] : hdToSources.get(row.hd) ?? []),
    });
  }

  for (const row of cns5) {
    const viaHip = row.hip === null ? undefined : hipToSource.get(row.hip);
    const reach: Reach<'edr3' | 'hip'> = row.gaiaSourceId !== null
      ? reachOf('edr3', [row.gaiaSourceId])
      : reachOf('hip', viaHip === undefined ? [] : [viaHip]);
    reaches.push({ kind: 'gj', cns5: row.cns5, gj: `${row.gj}${row.gjComp ?? ''}`, hip: row.hip, reach });
  }

  const checked = (o: RouteCheck['outcome']): number => routeChecks.filter((c) => c.outcome === o).length;
  return {
    overlay: overlayOf(reaches),
    tycsBySource,
    hdToSources,
    reaches,
    routeChecks,
    routeCounts: {
      tyc2HdRows: tyc2Hd.length,
      tyc2HdDistinctTyc: distinctTyc.size,
      tyc2HdAmbiguousRows: ambiguousRows,
      tycResolvedToSource: resolvedTyc.size,
      tycUnresolved: distinctTyc.size - resolvedTyc.size,
      crossIndexRows: crossIndex.length,
      bsc5Rows: bsc5.length,
      cns5Rows: cns5.length,
      hipXmatchEntries: hipToSource.size,
      hdHipRouteAgree: checked('agree'),
      hdHipRouteDisagree: checked('disagree'),
      hdHipRouteHipOnly: checked('hip-only'),
      crossIndexBayerUnkeyed: unreached(reaches, 'bayer'),
      crossIndexFlamsteedUnkeyed: unreached(reaches, 'flamsteed'),
      bsc5HrUnkeyed: unreached(reaches, 'hr'),
      cns5GjUnkeyed: unreached(reaches, 'gj'),
      cns5GjViaHip: reaches.filter((r) => r.kind === 'gj' && r.reach.kind === 'reached' && r.reach.route === 'hip').length,
    },
  };
}

/** See README.md#the-gates-evidence-has-to-be-pulled. */
export function magnitudeWeighableSourceIds(
  { overlay, tycsBySource }: Pick<OverlayCandidates, 'overlay' | 'tycsBySource'>,
  lookups: PrintedVLookups,
): Set<string> {
  const ids = new Set<string>();
  for (const [sourceId, entry] of overlay) {
    if (printedV(gateKeys(sourceId, entry, tycsBySource), lookups) !== null) ids.add(sourceId);
  }
  return ids;
}

export function buildClassicIdOverlay(input: OverlayInput): OverlayJoin {
  const { overlay, tycsBySource, hdToSources, routeChecks, routeCounts } =
    joinOverlayCandidates(input);
  const disagreements = routeChecks
    .filter((c) => c.outcome === 'disagree')
    .map(({ hd, hip, hdRouteSourceIds, hipRouteSourceId }) => ({ hd, hip, hdRouteSourceIds, hipRouteSourceId }));

  // Gate before counting, so every overlay* count describes the artifact
  // rather than the pre-vetting routing; routeCounts stay pre-gate.
  const gate = applyBindingGate(overlay, input.evidence, tycsBySource);
  for (const [hd, sources] of hdToSources) {
    const kept = sources.filter((s) => overlay.has(s));
    if (kept.length === sources.length) continue;
    if (kept.length === 0) hdToSources.delete(hd);
    else hdToSources.set(hd, kept);
  }

  const withValues = (pick: (e: OverlayEntry) => unknown[]): number => {
    let n = 0;
    for (const entry of overlay.values()) if (pick(entry).length > 0) n++;
    return n;
  };
  const withMultiple = (pick: (e: OverlayEntry) => unknown[]): number => {
    let n = 0;
    for (const entry of overlay.values()) if (pick(entry).length > 1) n++;
    return n;
  };

  return {
    overlay,
    disagreements,
    rejectedBindings: gate.rejected,
    counts: {
      ...routeCounts,

      overlayRows: overlay.size,
      overlayHd: withValues((e) => e.hd),
      overlayHr: withValues((e) => e.hr),
      overlayHip: withValues((e) => e.hip),
      overlayGj: withValues((e) => e.gj),
      overlayBayer: withValues((e) => e.bayer),
      overlayFlamsteed: withValues((e) => e.flamsteed),

      sourcesWithMultipleHd: withMultiple((e) => e.hd),
      sourcesWithMultipleHr: withMultiple((e) => e.hr),
      sourcesWithMultipleGj: withMultiple((e) => e.gj),
      sourcesWithMultipleBayer: withMultiple((e) => e.bayer),
      sourcesWithMultipleFlamsteed: withMultiple((e) => e.flamsteed),
      hdOnMultipleSources: [...hdToSources.values()].filter((s) => s.length > 1).length,

      gateRejectedMag: gate.rejected.filter((r) => r.reason === 'mag').length,
      gateRejectedSibling: gate.rejected.filter((r) => r.reason === 'sibling').length,
      gateSkippedNoPrintedV: gate.skippedNoPrintedV,
      gateableVia: gate.gateableVia,
      gateSkippedNoGMag: gate.skippedNoGMag,
      gateSkippedNullGMag: gate.skippedNullGMag,
    },
  };
}

/** Gaia saturates around G ≈ 3, so neither best-neighbour cross-walk carries
 *  the brightest stars and the overlay has no row for them at all — Vega,
 *  Sirius, Procyon and Betelgeuse are absent by construction, not by a join
 *  bug. The bright-tier counts below pin that population's size so a future
 *  session cannot mistake the overlay for the label authority. */
export const BRIGHT_TIER_MAG_CEILING = 3;

/** Strip a Gliese designation down to its bare catalogue number: "Gl 914B",
 *  "GJ 914" and CNS5's own "914.0" all reduce to "914".
 *
 *  The trailing `.0` matters: CNS5 prints whole numbers with one, while the
 *  Gliese supplement's genuinely fractional entries ("Gl 17.1") keep theirs, so
 *  only a zero fraction is a formatting artifact. Comparing the two
 *  conventions without collapsing it scores 14 same-star pairs as
 *  disagreements. */
export function glieseNumber(designation: string): string | null {
  const m = /^(?:Gl|GJ)?\s*([\d.]+)/.exec(designation.trim());
  if (!m) return null;
  return m[1].endsWith('.0') ? m[1].slice(0, -2) : m[1];
}

const glieseSuffix = (designation: string): string =>
  (/([A-Za-z]*)$/.exec(designation.trim())?.[1] ?? '').toUpperCase();

/** The ONE component a Gliese designation names, or null where it names the
 *  system rather than a star. CNS5's `gj_comp` states a multi-component
 *  system's letters combined — `Gl 423ABCD` is one entry for four stars — so a
 *  combined suffix and a bare number are both system-level claims and neither
 *  can contradict a record's own component letter. */
export function glieseComponent(designation: string): string | null {
  if (glieseNumber(designation) === null) return null;
  const suffix = glieseSuffix(designation);
  return suffix.length === 1 ? suffix : null;
}

/** A Gliese designation as the key a SID would take: the bare number plus
 *  whatever component it names, so `Gl 563.2a` and `GJ 563.2A` are one
 *  designation while `GJ 2060AB` and `GJ 2060C` are two. Anything asking who
 *  OWNS a designation needs this and not `glieseNumber`, which two components
 *  of one system share. */
export function glieseCellKey(designation: string): string | null {
  const number = glieseNumber(designation);
  return number === null ? null : `${number}${glieseSuffix(designation)}`;
}

