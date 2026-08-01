// The source_id-keyed classic-ID overlay join and its coverage counts.
// Routes, ambiguity policy and precedence: docs/catalog-driver.md § 2, § 4.
import type { Bsc5Row, Cns5Row, CrossIndexRow, Tyc2HdRow } from './classic-ids-parse';
import { sortSourceIdsNumeric } from '../export-astrometry-request-pure';
import { resolveGaiaSourceId, type SimbadWdsXidIndex } from '../catalog-pure';
// Type-only: the merge imports this module's values, so the runtime graph
// stays one-way.
import type { LabelMergeCounts } from './label-merge-pure';

/** Multi-value separator inside an overlay cell. A designation that names a
 *  catalogue granularity rather than one object attaches to every matching
 *  record, and a record can carry several (137 sources carry >1 HD), so no
 *  cell is single-valued by construction. */
export const OVERLAY_VALUE_SEPARATOR = '|';

export const OVERLAY_COLUMNS = [
  'gaia_source_id',
  'hd',
  'hr',
  'hip',
  'gj',
  'bayer',
  'flamsteed',
] as const;

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

export interface OverlayInput {
  tyc2Hd: readonly Tyc2HdRow[];
  crossIndex: readonly CrossIndexRow[];
  bsc5: readonly Bsc5Row[];
  cns5: readonly Cns5Row[];
  tycToSource: ReadonlyMap<string, string>;
  hipToSource: ReadonlyMap<number, string>;
  evidence: BindingEvidence;
}

/** Per-source photometry the binding gate below needs. `gMagOf` is Gaia's
 *  own G for the candidate source; `vMagOfHip` is the printed Hipparcos V
 *  of a HIP the overlay row claims. Both cross-walks feeding this join are
 *  best-neighbour tables, so an unvetted row can assert that a saturated
 *  star's designations belong to the faint companion Gaia actually fitted. */
export interface BindingEvidence {
  gMagOf: (sourceId: string) => number | null;
  vMagOfHip: (hip: number) => number | null;
  wdsXids: SimbadWdsXidIndex | null;
}

export function bindingEvidence(
  sourceGMag: ReadonlyMap<string, number>,
  hipVMag: ReadonlyMap<number, number>,
  wdsXids: SimbadWdsXidIndex | null,
): BindingEvidence {
  return {
    gMagOf: (sourceId) => sourceGMag.get(sourceId) ?? null,
    vMagOfHip: (hip) => hipVMag.get(hip) ?? null,
    wdsXids,
  };
}

/** An overlay row dropped because the source_id it keys is not the star its
 *  designations name. Emitted to `data/classic-ids/rejected_bindings.tsv` so
 *  the parity ledger can review what the gate removed. */
export interface RejectedBinding {
  sourceId: string;
  hip: number;
  vMag: number;
  gMag: number | null;
  reason: 'mag' | 'sibling';
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

/** Drop every overlay row whose source_id the record build would refuse to
 *  bind, running the SAME `resolveGaiaSourceId` gates `stars-parse.ts` applies
 *  rather than a second implementation of them.
 *
 *  The row's own HIP supplies the printed V the magnitude gate compares
 *  against Gaia's G, so only HIP-bearing rows with a printed V are gateable —
 *  `skippedNoHipVMag` counts the rest (see `data/classic-ids/README.md`
 *  § Coverage for the residual that bound leaves). Dropping the WHOLE row
 *  rather than just its `hip` cell is the point: both walks routinely land on
 *  the same wrong source, so if the source is not the star then every
 *  designation keyed on it is misattributed. The labels then ride the
 *  inherited spine, exactly as they do for the record build's rejected rows. */
export function applyBindingGate(
  overlay: ClassicIdOverlay,
  evidence: BindingEvidence,
): { rejected: RejectedBinding[]; skippedNoHipVMag: number } {
  const rejected: RejectedBinding[] = [];
  let skippedNoHipVMag = 0;
  for (const [sourceId, entry] of overlay) {
    // A row carrying several HIPs is a blend; saturation is a property of the
    // brightest of them, so that is the V the gate has to answer for.
    let vMag: number | null = null;
    let hip = 0;
    for (const candidate of entry.hip) {
      const v = evidence.vMagOfHip(candidate);
      if (v !== null && (vMag === null || v < vMag)) {
        vMag = v;
        hip = candidate;
      }
    }
    if (vMag === null) {
      skippedNoHipVMag++;
      continue;
    }
    const verdict = resolveGaiaSourceId(
      sourceId, hip, null, vMag, evidence.gMagOf, evidence.wdsXids,
    );
    if (verdict.gaiaSourceId !== null) continue;
    rejected.push({
      sourceId,
      hip,
      vMag,
      gMag: evidence.gMagOf(sourceId),
      reason: verdict.magRejected ? 'mag' : 'sibling',
      designations: designationSummary(entry),
    });
  }
  for (const r of rejected) overlay.delete(r.sourceId);
  return { rejected, skippedNoHipVMag };
}

/** An IV/27A row whose HD→TYC→source_id route and HIP→source_id route
 *  disagree. The HD route is the authority (§ 4); these go to the parity
 *  ledger's review queue rather than being resolved mechanically. */
export interface HdHipRouteDisagreement {
  hd: number;
  hip: number;
  hdRouteSourceIds: string[];
  hipRouteSourceId: string;
}

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
   *  Every `overlay*` count above is post-gate — it describes the artifact. */
  gateRejectedMag: number;
  gateRejectedSibling: number;
  gateSkippedNoHipVMag: number;

  hdHipRouteAgree: number;
  hdHipRouteDisagree: number;
  /** IV/27A rows whose HIP resolves but whose HD reaches no source_id — the
   *  HIP route is the only one that keys them. */
  hdHipRouteHipOnly: number;

  /** Upstream designations no route keys to a source_id. They are not lost
   *  records: their labels ride the inherited spine (§ 1), which is why the
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

export function buildClassicIdOverlay(input: OverlayInput): OverlayJoin {
  const { tyc2Hd, crossIndex, bsc5, cns5, tycToSource, hipToSource, evidence } = input;
  const overlay: ClassicIdOverlay = new Map();

  // HD → TYC → source_id is the primary route: every HD-bearing AT-HYG row
  // also carries a TYC, so no HD needs the HIP route as an authority.
  const hdToSources = new Map<number, string[]>();
  const distinctTyc = new Set<string>();
  const resolvedTyc = new Set<string>();
  let ambiguousRows = 0;
  for (const row of tyc2Hd) {
    distinctTyc.add(row.tyc);
    if (row.nHd > 1 || row.nTyc > 1) ambiguousRows++;
    const sourceId = tycToSource.get(row.tyc);
    if (sourceId === undefined) continue;
    resolvedTyc.add(row.tyc);
    addValue(entryFor(overlay, sourceId).hd, row.hd);
    const sources = hdToSources.get(row.hd);
    if (sources === undefined) hdToSources.set(row.hd, [sourceId]);
    else addValue(sources, sourceId);
  }

  // HIP is a designation in its own right, so every cross-walk entry keys a
  // label — the walk is not merely a routing table here.
  for (const [hip, sourceId] of hipToSource) {
    addValue(entryFor(overlay, sourceId).hip, hip);
  }

  const disagreements: HdHipRouteDisagreement[] = [];
  let hipRouteAgree = 0;
  let hipRouteHipOnly = 0;
  let bayerUnkeyed = 0;
  let flamsteedUnkeyed = 0;
  for (const row of crossIndex) {
    const hdRoute = hdToSources.get(row.hd) ?? [];
    const hipRoute = row.hip === null ? undefined : hipToSource.get(row.hip);
    if (row.hip !== null && hipRoute !== undefined) {
      if (hdRoute.length === 0) hipRouteHipOnly++;
      else if (hdRoute.includes(hipRoute)) hipRouteAgree++;
      else {
        disagreements.push({
          hd: row.hd,
          hip: row.hip,
          hdRouteSourceIds: [...hdRoute],
          hipRouteSourceId: hipRoute,
        });
      }
    }
    const targets = hdRoute.length > 0 ? hdRoute : hipRoute ? [hipRoute] : [];
    if (row.bayer !== null && row.cst !== null) {
      if (targets.length === 0) bayerUnkeyed++;
      for (const sourceId of targets) {
        addValue(entryFor(overlay, sourceId).bayer, `${row.bayer} ${row.cst}`);
      }
    }
    if (row.flamsteed !== null && row.cst !== null) {
      if (targets.length === 0) flamsteedUnkeyed++;
      for (const sourceId of targets) {
        addValue(entryFor(overlay, sourceId).flamsteed, `${row.flamsteed} ${row.cst}`);
      }
    }
  }

  let hrUnkeyed = 0;
  for (const row of bsc5) {
    const targets = row.hd === null ? [] : hdToSources.get(row.hd) ?? [];
    if (targets.length === 0) {
      hrUnkeyed++;
      continue;
    }
    for (const sourceId of targets) addValue(entryFor(overlay, sourceId).hr, row.hr);
  }

  let gjUnkeyed = 0;
  let gjViaHip = 0;
  for (const row of cns5) {
    let sourceId = row.gaiaSourceId;
    if (sourceId === null && row.hip !== null) {
      sourceId = hipToSource.get(row.hip) ?? null;
      if (sourceId !== null) gjViaHip++;
    }
    if (sourceId === null) {
      gjUnkeyed++;
      continue;
    }
    const entry = entryFor(overlay, sourceId);
    addValue(entry.gj, `${row.gj}${row.gjComp ?? ''}`);
    if (row.hip !== null) addValue(entry.hip, row.hip);
  }

  for (const entry of overlay.values()) {
    entry.hd.sort((a, b) => a - b);
    entry.hr.sort((a, b) => a - b);
    entry.hip.sort((a, b) => a - b);
    entry.gj.sort();
    entry.bayer.sort();
    entry.flamsteed.sort();
  }

  // Gate before counting, so every overlay* count describes the artifact
  // rather than the pre-vetting routing. The route counters above keep
  // describing upstream reachability and are deliberately left pre-gate.
  const gate = applyBindingGate(overlay, evidence);
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
      tyc2HdRows: tyc2Hd.length,
      tyc2HdDistinctTyc: distinctTyc.size,
      tyc2HdAmbiguousRows: ambiguousRows,
      tycResolvedToSource: resolvedTyc.size,
      tycUnresolved: distinctTyc.size - resolvedTyc.size,
      crossIndexRows: crossIndex.length,
      bsc5Rows: bsc5.length,
      cns5Rows: cns5.length,
      hipXmatchEntries: hipToSource.size,

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
      gateSkippedNoHipVMag: gate.skippedNoHipVMag,

      hdHipRouteAgree: hipRouteAgree,
      hdHipRouteDisagree: disagreements.length,
      hdHipRouteHipOnly: hipRouteHipOnly,

      crossIndexBayerUnkeyed: bayerUnkeyed,
      crossIndexFlamsteedUnkeyed: flamsteedUnkeyed,
      bsc5HrUnkeyed: hrUnkeyed,
      cns5GjUnkeyed: gjUnkeyed,
      cns5GjViaHip: gjViaHip,
    },
  };
}

export function serializeOverlay(overlay: ClassicIdOverlay): string {
  const sep = OVERLAY_VALUE_SEPARATOR;
  const lines = [OVERLAY_COLUMNS.join('\t')];
  for (const sourceId of sortSourceIdsNumeric(overlay.keys())) {
    const e = overlay.get(sourceId)!;
    lines.push([
      sourceId,
      e.hd.join(sep),
      e.hr.join(sep),
      e.hip.join(sep),
      e.gj.join(sep),
      e.bayer.join(sep),
      e.flamsteed.join(sep),
    ].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

/** Read the committed overlay back. Demands the header be `OVERLAY_COLUMNS`
 *  byte for byte, in order — the same contract `iterSpineTsv` holds its own
 *  frozen artifact to (`../parse/README.md` § TSV header resolution): this
 *  file's only writer is `serializeOverlay` above, so a header that merely
 *  parses is already a file nobody meant to ship. */
export function parseOverlayTsv(text: string): ClassicIdOverlay {
  const lines = text.split(/\r?\n/);
  const header = OVERLAY_COLUMNS.join('\t');
  if (lines[0] !== header) {
    throw new Error(
      `classic_id_overlay.tsv header is "${lines[0] ?? ''}", expected ` +
        `"${header}" — re-run \`pnpm run build:classic-ids\`.`,
    );
  }
  const overlay: ClassicIdOverlay = new Map();
  const cells = (v: string): string[] =>
    v === '' ? [] : v.split(OVERLAY_VALUE_SEPARATOR);
  const ints = (v: string): number[] => cells(v).map(Number);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const [sourceId, hd, hr, hip, gj, bayer, flamsteed] = lines[i].split('\t');
    overlay.set(sourceId, {
      hd: ints(hd),
      hr: ints(hr),
      hip: ints(hip),
      gj: cells(gj),
      bayer: cells(bayer),
      flamsteed: cells(flamsteed),
    });
  }
  return overlay;
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

/** The join's own counts plus the label merge measured over the membership
 *  term. Per-identifier coverage is `labelAgree / (labelAgree + labelFlipped +
 *  labelSpineOnly)` from the merge counts — the same walk that decides what the
 *  record build writes, so the published figure cannot drift from the shipped
 *  labels the way a second measurement over a retired input could. */
export interface ClassicIdOverlayCounts extends OverlayJoinCounts, LabelMergeCounts {
  spineRows: number;
  /** Spine rows carrying no source_id at all — the no-Gaia residual, whose
   *  labels can only ride the spine. */
  spineRowsWithoutSourceId: number;
  spineRowsWithoutOverlayEntry: number;
  spineBrightRows: number;
  spineBrightRowsWithoutOverlayEntry: number;
}
