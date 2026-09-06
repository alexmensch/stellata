// Post-build self-consistency + SIMBAD distance gate: flags stars whose
// shipped distance has drifted from the parallax cascade's own inversion or
// from SIMBAD's parallax-derived value. Snapshot-pinned by build-catalog.ts.

import { parseSimbadSampleRows } from '../validate/simbad-sample-parse';
import type { Star } from '../parse/stars-parse';
import type { DistVia } from './parallax/parallax-cascade';

// Only an override layer moves a record off its own inversion. Bailer-Jones
// legitimately re-anchors the low-S/N tail of Gaia parallaxes, so that tier
// is held loosely; every other measured tier is parallax-anchored ground truth
// and a 3× shift signals an override misfire. Tiers absent here (curated,
// none, and the two override layers themselves) are not checked.
export const SELF_CONSISTENCY_THRESHOLDS: Readonly<Partial<Record<DistVia, number>>> = {
  gaia_dr3_inversion: Math.log10(30),
  hip2_parallax: Math.log10(3),
  cns5_plx: Math.log10(3),
  gliese_plx: Math.log10(3),
  simbad_plx: Math.log10(3),
  pair_member_parallax: Math.log10(3),
  gliese_photometric_plx: Math.log10(3),
};

export const SIMBAD_DISTANCE_THRESHOLD = Math.log10(5);

export interface SimbadDistanceEntry {
  simbadOid: number;
  simbadMainId: string;
  distancePc: number;
}

// `reason` is a hand-edited rationale carried in the committed snapshot —
// "ρ Cas yellow hypergiant; SIMBAD's 1/π is the noisy Hipparcos value",
// "LMC kinematic snap legitimate", etc. Omitted on fresh detection;
// preserved across UPDATE_DISTANCE_OUTLIERS=1 refreshes via mergeReasons
// so a refresh never silently drops the rationale a human wrote. Not part
// of the equality check — editing a reason in the snapshot does not fail
// the build.
export interface SelfConsistencyOutlier {
  id: string;          // canonical join key — "gaia:<source_id>" or "hip:<N>"
  plxVia: DistVia;     // the parallax tier whose inversion tripped the threshold
  plxDist: number;     // the cascade's own inversion (pc), pre-override
  finalDist: number;   // pipeline final distance (pc)
  logRatio: number;    // log10(finalDist / plxDist), rounded to 3 decimals
  reason?: string;
}

export interface SimbadOutlier {
  id: string;
  finalDist: number;        // pc
  simbadDist: number;       // pc
  simbadMainId: string;     // SIMBAD's main_id, surfaced for human eyeballs
  logRatio: number;
  reason?: string;
}

export interface RegressionReport {
  selfConsistency: SelfConsistencyOutlier[];
  simbad: SimbadOutlier[];
}

/** Stable identifier used as the snapshot join key. Gaia DR3 source_id
 *  wins where present (more reliable than HIP for the Gaia bulk); HIP is the
 *  fallback. Returns null when the star carries neither. */
export function starKey(star: Pick<Star, 'gaiaSourceId' | 'hip'>): string | null {
  if (star.gaiaSourceId) return `gaia:${star.gaiaSourceId}`;
  if (star.hip !== null) return `hip:${star.hip}`;
  return null;
}

/** Positions are in pc from Sol; the pipeline's final distance is the
 *  Euclidean magnitude. */
export function finalDistance(star: Pick<Star, 'x' | 'y' | 'z'>): number {
  return Math.hypot(star.x, star.y, star.z);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Detect the self-consistency outlier for one star, or null if the row's
 *  tier has no threshold opinion, is missing inputs, or sits within
 *  tolerance. */
export function detectSelfConsistencyOutlier(
  star: Star,
): SelfConsistencyOutlier | null {
  const plxVia = star.plxVia;
  if (plxVia === null) return null;
  const threshold = SELF_CONSISTENCY_THRESHOLDS[plxVia];
  if (threshold === undefined) return null;
  if (star.plxDistPc === null || star.plxDistPc <= 0) return null;
  const id = starKey(star);
  if (!id) return null;
  const final = finalDistance(star);
  if (final <= 0) return null;
  const logRatio = Math.log10(final / star.plxDistPc);
  if (Math.abs(logRatio) <= threshold) return null;
  return {
    id,
    plxVia,
    plxDist: round3(star.plxDistPc),
    finalDist: round3(final),
    logRatio: round3(logRatio),
  };
}

/** Detect the SIMBAD-anchored outlier for one star, or null if it isn't
 *  in the sample / its SIMBAD row lacks a usable distance / it sits within
 *  tolerance / its distance came from SIMBAD in the first place. */
export function detectSimbadOutlier(
  star: Star,
  simbadSample: ReadonlyMap<string, SimbadDistanceEntry>,
): SimbadOutlier | null {
  // § 5's validation independence: a distance the SIMBAD tier supplied would
  // be checked against the parallax it was derived from, so its residual is
  // zero by construction and reports agreement that was never measured.
  if (star.distVia === 'simbad_plx') return null;
  const id = starKey(star);
  if (!id) return null;
  const entry = simbadSample.get(id);
  if (!entry || entry.distancePc <= 0) return null;
  const final = finalDistance(star);
  if (final <= 0) return null;
  const logRatio = Math.log10(final / entry.distancePc);
  if (Math.abs(logRatio) <= SIMBAD_DISTANCE_THRESHOLD) return null;
  return {
    id,
    finalDist: round3(final),
    simbadDist: round3(entry.distancePc),
    simbadMainId: entry.simbadMainId,
    logRatio: round3(logRatio),
  };
}

/** Sweep the catalog and produce the full regression report. Sorted by
 *  id within each section for stable snapshot diffs. */
export function buildRegressionReport(
  stars: readonly Star[],
  simbadSample: ReadonlyMap<string, SimbadDistanceEntry>,
): RegressionReport {
  const selfConsistency: SelfConsistencyOutlier[] = [];
  const simbad: SimbadOutlier[] = [];
  for (const star of stars) {
    const sc = detectSelfConsistencyOutlier(star);
    if (sc) selfConsistency.push(sc);
    const sb = detectSimbadOutlier(star, simbadSample);
    if (sb) simbad.push(sb);
  }
  selfConsistency.sort((a, b) => a.id.localeCompare(b.id));
  simbad.sort((a, b) => a.id.localeCompare(b.id));
  return { selfConsistency, simbad };
}

/** Parse the SIMBAD sample TSV into a join-key Map. Each row may
 *  contribute up to two entries (gaia:N and hip:N) when both identifiers
 *  are present, so star-side lookup can succeed via either key. Rows
 *  with no usable distance are skipped. */
export function parseSimbadSampleTsv(
  text: string,
): Map<string, SimbadDistanceEntry> {
  const out = new Map<string, SimbadDistanceEntry>();
  for (const row of parseSimbadSampleRows(text)) {
    if (row.distancePc === null || row.distancePc <= 0) continue;
    const entry: SimbadDistanceEntry = {
      simbadOid: row.simbadOid,
      simbadMainId: row.simbadMainId,
      distancePc: row.distancePc,
    };
    if (row.gaiaSourceId) out.set(`gaia:${row.gaiaSourceId}`, entry);
    if (row.hip !== null) out.set(`hip:${row.hip}`, entry);
  }
  return out;
}

export type OutlierDiff =
  | { section: 'selfConsistency' | 'simbad'; status: 'unchanged'; id: string }
  | { section: 'selfConsistency' | 'simbad'; status: 'added'; outlier: SelfConsistencyOutlier | SimbadOutlier }
  | { section: 'selfConsistency' | 'simbad'; status: 'removed'; id: string }
  | {
      section: 'selfConsistency' | 'simbad';
      status: 'changed';
      id: string;
      expected: SelfConsistencyOutlier | SimbadOutlier;
      actual: SelfConsistencyOutlier | SimbadOutlier;
    };

/** Equality on data fields only — `reason` is hand-edited metadata and
 *  varying it must not flip a snapshot from match to changed. */
function outliersEqual<T extends SelfConsistencyOutlier | SimbadOutlier>(
  a: T,
  b: T,
): boolean {
  const { reason: _ra, ...aRest } = a;
  const { reason: _rb, ...bRest } = b;
  return JSON.stringify(aRest) === JSON.stringify(bRest);
}

function diffSection<T extends SelfConsistencyOutlier | SimbadOutlier>(
  section: 'selfConsistency' | 'simbad',
  expected: readonly T[],
  actual: readonly T[],
): OutlierDiff[] {
  const expectedById = new Map(expected.map((o) => [o.id, o]));
  const actualById = new Map(actual.map((o) => [o.id, o]));
  const diffs: OutlierDiff[] = [];
  for (const [id, exp] of expectedById) {
    const act = actualById.get(id);
    if (!act) {
      diffs.push({ section, status: 'removed', id });
    } else if (!outliersEqual(exp, act)) {
      diffs.push({ section, status: 'changed', id, expected: exp, actual: act });
    } else {
      diffs.push({ section, status: 'unchanged', id });
    }
  }
  for (const [id, act] of actualById) {
    if (!expectedById.has(id)) {
      diffs.push({ section, status: 'added', outlier: act });
    }
  }
  return diffs;
}

/** Carry over hand-edited `reason` rationales from a prior snapshot onto
 *  a freshly-computed report. Called on UPDATE_DISTANCE_OUTLIERS=1
 *  refreshes so existing reasons survive an explicit rebaseline; new
 *  outliers land without a reason for the committing human to fill in. */
export function mergeReasonsFromSnapshot(
  expected: RegressionReport,
  actual: RegressionReport,
): RegressionReport {
  const expectedSc = new Map(expected.selfConsistency.map((o) => [o.id, o]));
  const expectedSb = new Map(expected.simbad.map((o) => [o.id, o]));
  return {
    selfConsistency: actual.selfConsistency.map((o) => {
      const prev = expectedSc.get(o.id);
      return prev?.reason ? { ...o, reason: prev.reason } : o;
    }),
    simbad: actual.simbad.map((o) => {
      const prev = expectedSb.get(o.id);
      return prev?.reason ? { ...o, reason: prev.reason } : o;
    }),
  };
}

/** Compare two reports and emit per-outlier diffs. Pure — no I/O. */
export function compareRegressionReports(
  expected: RegressionReport,
  actual: RegressionReport,
): OutlierDiff[] {
  return [
    ...diffSection('selfConsistency', expected.selfConsistency, actual.selfConsistency),
    ...diffSection('simbad', expected.simbad, actual.simbad),
  ];
}

/** Pretty-printer for the diff. Mismatches (added / removed / changed)
 *  surface first; the unchanged tail is summarised as a count. */
export function formatRegressionDiff(diff: readonly OutlierDiff[]): string {
  const drift = diff.filter((d) => d.status !== 'unchanged');
  const unchangedSc = diff.filter(
    (d) => d.section === 'selfConsistency' && d.status === 'unchanged',
  ).length;
  const unchangedSb = diff.filter(
    (d) => d.section === 'simbad' && d.status === 'unchanged',
  ).length;
  const lines: string[] = [];
  if (drift.length === 0) {
    lines.push(
      `distance-regression: snapshot match (selfConsistency=${unchangedSc}, simbad=${unchangedSb})`,
    );
    return lines.join('\n');
  }
  lines.push(
    `distance-regression: ${drift.length} change(s) vs snapshot ` +
      `(selfConsistency unchanged=${unchangedSc}, simbad unchanged=${unchangedSb})`,
  );
  for (const d of drift) {
    if (d.status === 'added') {
      lines.push(`  +${d.section} ${d.outlier.id}  ${formatOutlier(d.outlier)}`);
    } else if (d.status === 'removed') {
      lines.push(`  -${d.section} ${d.id}`);
    } else if (d.status === 'changed') {
      lines.push(
        `  ~${d.section} ${d.id}` +
          `\n      expected: ${formatOutlier(d.expected)}` +
          `\n      actual:   ${formatOutlier(d.actual)}`,
      );
    }
  }
  return lines.join('\n');
}

function formatOutlier(o: SelfConsistencyOutlier | SimbadOutlier): string {
  if ('plxDist' in o) {
    return `plx_via=${o.plxVia} plx=${o.plxDist}pc final=${o.finalDist}pc logRatio=${o.logRatio}`;
  }
  return `final=${o.finalDist}pc simbad=${o.simbadDist}pc (${o.simbadMainId}) logRatio=${o.logRatio}`;
}
