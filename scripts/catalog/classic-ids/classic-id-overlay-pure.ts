// The source_id-keyed classic-ID overlay join and its coverage counts.
// Routes, ambiguity policy and precedence: docs/catalog-driver.md § 2, § 4.
import type { Bsc5Row, Cns5Row, CrossIndexRow, Tyc2HdRow } from './classic-ids-parse';
import { sortSourceIdsNumeric } from '../export-astrometry-request-pure';
import { nonEmpty } from '../parse/corpus-tsv';

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
  sourcesWithMultipleBayer: number;
  hdOnMultipleSources: number;

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
  const { tyc2Hd, crossIndex, bsc5, cns5, tycToSource, hipToSource } = input;
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
      sourcesWithMultipleBayer: withMultiple((e) => e.bayer),
      hdOnMultipleSources: [...hdToSources.values()].filter((s) => s.length > 1).length,

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

/** AT-HYG stores a missing classical identifier as either an empty cell or
 *  the literal "0" — the TS mirror of `refresh_lib.athyg_int_or_none`. A
 *  plain integer parse would return a sentinel-0 that then matches nothing
 *  and inflates the "keyed" side of label parity. */
export function athygIdOrNull(cell: string | undefined): number | null {
  const t = nonEmpty(cell);
  if (t === null || t === '0') return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One AT-HYG row reduced to what label parity compares. */
export interface AthygLabelRow {
  sourceId: string | null;
  mag: number | null;
  hd: number | null;
  hip: number | null;
  hr: number | null;
  gl: string | null;
  bayer: string | null;
  flam: number | null;
}

/** Gaia saturates around G ≈ 3, so neither best-neighbour cross-walk carries
 *  the brightest stars and the overlay has no row for them at all — Vega,
 *  Sirius, Procyon and Betelgeuse are absent by construction, not by a join
 *  bug. The bright-tier counts below pin that population's size so a future
 *  session cannot mistake the overlay for the label authority. */
export const BRIGHT_TIER_MAG_CEILING = 3;

/** Per-identifier label parity of the overlay against the AT-HYG rows it
 *  can reach. `*Keyed` counts AT-HYG rows that resolve to a source_id AND
 *  carry the identifier; `*Covered` counts those the overlay reproduces
 *  under that same source_id.
 *
 *  hd / hip / hr / gl compare values (`gl` on its GJ number, since the
 *  Gl-vs-GJ prefix and component suffix are display forms). `bayer`
 *  compares presence only: IV/27A spells Bayer letters "alf" where AT-HYG
 *  spells them "Alp", and reconciling the two is the naming-authority
 *  ladder's job, not this join's. */
export interface AthygLabelParity {
  hdKeyed: number;
  hdCovered: number;
  hipKeyed: number;
  hipCovered: number;
  hrKeyed: number;
  hrCovered: number;
  glKeyed: number;
  glCovered: number;
  bayerKeyed: number;
  bayerCovered: number;
  flamKeyed: number;
  flamCovered: number;
}

/** Strip a Gliese designation down to its bare catalogue number: "Gl 914B"
 *  and "GJ 914" both reduce to "914". */
export function glieseNumber(designation: string): string | null {
  const m = /^(?:Gl|GJ)\s*([\d.]+)/.exec(designation.trim());
  return m ? m[1] : null;
}

function overlayGlNumbers(entry: OverlayEntry): Set<string> {
  const out = new Set<string>();
  for (const gj of entry.gj) {
    const m = /^([\d.]+)/.exec(gj);
    if (m) out.add(m[1]);
  }
  return out;
}

function overlayFlamsteedNumbers(entry: OverlayEntry): Set<number> {
  const out = new Set<number>();
  for (const f of entry.flamsteed) {
    const n = Number.parseInt(f, 10);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

export interface AthygParityResult {
  rows: number;
  rowsWithoutSourceId: number;
  /** Rows that resolve to a source_id the overlay has no entry for. */
  rowsWithoutOverlayEntry: number;
  brightRows: number;
  brightRowsWithoutOverlayEntry: number;
  parity: AthygLabelParity;
}

export function measureAthygLabelParity(
  rows: Iterable<AthygLabelRow>,
  overlay: ClassicIdOverlay,
): AthygParityResult {
  const parity: AthygLabelParity = {
    hdKeyed: 0, hdCovered: 0,
    hipKeyed: 0, hipCovered: 0,
    hrKeyed: 0, hrCovered: 0,
    glKeyed: 0, glCovered: 0,
    bayerKeyed: 0, bayerCovered: 0,
    flamKeyed: 0, flamCovered: 0,
  };
  let total = 0;
  let withoutSourceId = 0;
  let withoutEntry = 0;
  let bright = 0;
  let brightWithoutEntry = 0;
  for (const row of rows) {
    total++;
    const isBright = row.mag !== null && row.mag <= BRIGHT_TIER_MAG_CEILING;
    if (isBright) bright++;
    if (row.sourceId === null) {
      withoutSourceId++;
      withoutEntry++;
      if (isBright) brightWithoutEntry++;
      continue;
    }
    const entry = overlay.get(row.sourceId);
    if (entry === undefined) {
      withoutEntry++;
      if (isBright) brightWithoutEntry++;
    }
    const score = (
      keyed: keyof AthygLabelParity,
      covered: keyof AthygLabelParity,
      present: boolean,
      reproduced: () => boolean,
    ): void => {
      if (!present) return;
      parity[keyed]++;
      if (entry !== undefined && reproduced()) parity[covered]++;
    };
    score('hdKeyed', 'hdCovered', row.hd !== null,
      () => entry!.hd.includes(row.hd!));
    score('hipKeyed', 'hipCovered', row.hip !== null,
      () => entry!.hip.includes(row.hip!));
    score('hrKeyed', 'hrCovered', row.hr !== null,
      () => entry!.hr.includes(row.hr!));
    score('glKeyed', 'glCovered', row.gl !== null, () => {
      const n = glieseNumber(row.gl!);
      return n !== null && overlayGlNumbers(entry!).has(n);
    });
    score('bayerKeyed', 'bayerCovered', row.bayer !== null,
      () => entry!.bayer.length > 0);
    score('flamKeyed', 'flamCovered', row.flam !== null,
      () => overlayFlamsteedNumbers(entry!).has(row.flam!));
  }
  return {
    rows: total,
    rowsWithoutSourceId: withoutSourceId,
    rowsWithoutOverlayEntry: withoutEntry,
    brightRows: bright,
    brightRowsWithoutOverlayEntry: brightWithoutEntry,
    parity,
  };
}

export interface ClassicIdOverlayCounts extends OverlayJoinCounts {
  athygRows: number;
  athygRowsWithoutSourceId: number;
  athygRowsWithoutOverlayEntry: number;
  athygBrightRows: number;
  athygBrightRowsWithoutOverlayEntry: number;
  athygLabelParity: AthygLabelParity;
}
