// Post-build distance-regression check — guards against override-misfire
// bugs of the shape that produced dch.47 (eleven stars rendered at 16-40 kpc
// instead of their correct 0.2-1 kpc Hipparcos distances).
//
// Two layered checks:
//
//   (1) Self-consistency. For each star with an AT-HYG `dist` and a
//       `dist_src` we have a threshold opinion on, compare the AT-HYG
//       input distance against the pipeline's final distance. Threshold
//       is bracketed by source category — HIP / GJ / N are parallax-
//       based ground truth where a 3× shift is a strong misfire signal;
//       G_R3 / G_R2 are Gaia inverse-parallax where even catastrophic-
//       inversion outliers shouldn't shift by more than ~30× post-B-J.
//
//   (2) SIMBAD cross-check. For each star reachable via the committed
//       `data/simbad/simbad_sample.tsv` (~10k V-mag-stratified rows, key
//       on Gaia DR3 source_id with HIP fallback), compare the pipeline
//       distance against SIMBAD's parallax-derived distance. Any ratio
//       outside [1/5, 5] is flagged.
//
// The SIMBAD check is an offline file join — no network call. The
// upstream `refresh-simbad-sample.py` is manual + idempotent per
// `frozen-external-data`.
//
// Both check halves return structured outlier records. Build-catalog.ts
// diffs the report against a committed `build-distance-outliers-expected.json`
// snapshot and fails the build on any new or stale outlier. Refresh
// deliberately with `UPDATE_DISTANCE_OUTLIERS=1 npm run build:catalog`.

import type { Star } from './stars-parse';

// Per AT-HYG `dist_src` category, the |log10(final/athyg)| threshold
// above which a star is flagged as a self-consistency outlier.
//
// STRICT (factor 3+, log10 ≈ 0.477) — HIP/GJ/N are parallax-anchored;
// a 3× shift indicates an override misfire on a row whose input was
// already trustworthy. The dch.47 bug exemplars sat at 20-146× from
// their HIP values.
//
// LOOSE (factor 30+, log10 ≈ 1.477) — G_R3/G_R2 are Gaia inverse
// parallaxes whose low-S/N tail legitimately gets re-anchored by
// Bailer-Jones; flagging only the very largest residuals after override.
//
// Categories not present in this table (OTHER, blank) are not checked.
export const SELF_CONSISTENCY_THRESHOLDS: Readonly<Record<string, number>> = {
  HIP: Math.log10(3),
  GJ: Math.log10(3),
  N: Math.log10(3),
  G_R3: Math.log10(30),
  G_R2: Math.log10(30),
};

// SIMBAD cross-check threshold — any |log10(final / simbad)| beyond this
// is flagged. Catches the dch.47-shaped systematic 20-150× misfires.
export const SIMBAD_DISTANCE_THRESHOLD = Math.log10(5);

export interface SimbadDistanceEntry {
  simbadOid: number;
  simbadMainId: string;
  distancePc: number;
}

export interface SelfConsistencyOutlier {
  id: string;          // canonical join key — "gaia:<source_id>" or "hip:<N>"
  distSrc: string;     // AT-HYG dist_src category that tripped the threshold
  athygDist: number;   // AT-HYG input distance (pc)
  finalDist: number;   // pipeline final distance (pc)
  logRatio: number;    // log10(finalDist / athygDist), rounded to 3 decimals
}

export interface SimbadOutlier {
  id: string;
  finalDist: number;        // pc
  simbadDist: number;       // pc
  simbadMainId: string;     // SIMBAD's main_id, surfaced for human eyeballs
  logRatio: number;
}

export interface RegressionReport {
  selfConsistency: SelfConsistencyOutlier[];
  simbad: SimbadOutlier[];
}

/** Stable identifier used as the snapshot join key. Gaia DR3 source_id
 *  wins where present (more reliable than HIP for the AT-HYG-Gaia bulk);
 *  HIP is the fallback. Returns null when the star carries neither. */
export function starKey(star: Pick<Star, 'gaiaSourceId' | 'hip'>): string | null {
  if (star.gaiaSourceId) return `gaia:${star.gaiaSourceId}`;
  if (star.hip !== null) return `hip:${star.hip}`;
  return null;
}

/** Floating-origin AT-HYG positions are in pc from Sol; the pipeline's
 *  final distance is the Euclidean magnitude. */
export function finalDistance(star: Pick<Star, 'x' | 'y' | 'z'>): number {
  return Math.hypot(star.x, star.y, star.z);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Detect the self-consistency outlier for one star, or null if the row
 *  has no threshold opinion, is missing inputs, or sits within tolerance. */
export function detectSelfConsistencyOutlier(
  star: Star,
): SelfConsistencyOutlier | null {
  const distSrc = star.athygDistSrc;
  if (!distSrc) return null;
  const threshold = SELF_CONSISTENCY_THRESHOLDS[distSrc];
  if (threshold === undefined) return null;
  if (star.athygDist === null || star.athygDist <= 0) return null;
  const id = starKey(star);
  if (!id) return null;
  const final = finalDistance(star);
  if (final <= 0) return null;
  const logRatio = Math.log10(final / star.athygDist);
  if (Math.abs(logRatio) <= threshold) return null;
  return {
    id,
    distSrc,
    athygDist: round3(star.athygDist),
    finalDist: round3(final),
    logRatio: round3(logRatio),
  };
}

/** Detect the SIMBAD-anchored outlier for one star, or null if it isn't
 *  in the sample / its SIMBAD row lacks a usable distance / it sits within
 *  tolerance. */
export function detectSimbadOutlier(
  star: Star,
  simbadSample: ReadonlyMap<string, SimbadDistanceEntry>,
): SimbadOutlier | null {
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
  const lines = text.split('\n');
  if (lines.length < 2) return out;
  const header = lines[0].split('\t');
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) {
      throw new Error(`simbad_sample.tsv missing required column: ${name}`);
    }
    return idx;
  };
  const cOid = col('simbad_oid');
  const cMainId = col('simbad_main_id');
  const cHip = col('hip');
  const cGaia = col('gaia_source_id');
  const cDist = col('distance_pc');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');
    const distStr = cols[cDist];
    if (!distStr) continue;
    const distancePc = Number(distStr);
    if (!Number.isFinite(distancePc) || distancePc <= 0) continue;
    const entry: SimbadDistanceEntry = {
      simbadOid: Number(cols[cOid]),
      simbadMainId: cols[cMainId] ?? '',
      distancePc,
    };
    const gaia = cols[cGaia];
    if (gaia) out.set(`gaia:${gaia}`, entry);
    const hip = cols[cHip];
    if (hip) out.set(`hip:${hip}`, entry);
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
    } else if (JSON.stringify(exp) !== JSON.stringify(act)) {
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
  if ('athygDist' in o) {
    return `dist_src=${o.distSrc} athyg=${o.athygDist}pc final=${o.finalDist}pc logRatio=${o.logRatio}`;
  }
  return `final=${o.finalDist}pc simbad=${o.simbadDist}pc (${o.simbadMainId}) logRatio=${o.logRatio}`;
}
