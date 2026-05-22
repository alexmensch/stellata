// Manual-run Tier-C validator — cross-checks Stellata's catalog.bin
// absmag and distance against SIMBAD's published values for the
// 50k-row sample in data/simbad/simbad_sample.tsv. Build-time distance
// regression detection is already gated by
// `scripts/catalog/distance-regression-check.ts` (per-star factor-5
// threshold, snapshot-pinned); this script is the deeper population
// view — residual histograms, percentile stats, and the top-N outliers
// for a human pass.
//
// PM is intentionally out of scope WHILE catalog.bin remains
// J2000-epoch: the binary stores AT-HYG positions without PM
// propagation, so a PM residual would compare AT-HYG's PM to SIMBAD's
// PM rather than anything Stellata emits. Revisit if stellata-nmu.1's
// time-scrubber design decision lands and the build starts applying
// PM to bring positions to render epoch — `parseSimbadSampleRows`
// already surfaces pmra / pmdec for that case.
//
// Run: `npm run validate:simbad`. Writes
// `docs/validation-residuals.md` and exits non-zero when the smoke
// thresholds in `RESIDUAL_THRESHOLDS` fire.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCatalog,
  lookupByGaiaSourceId,
  lookupByHip,
  distancePc,
  type Catalog,
  type CatalogRecord,
} from './catalog-lookup';
import {
  parseSimbadSampleRows,
  type SimbadSampleRow,
} from './distance-regression-check';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SAMPLE_PATH = resolve(REPO_ROOT, 'data/simbad/simbad_sample.tsv');
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, 'docs/validation-residuals.md');

// ─── Thresholds ──────────────────────────────────────────────────────

// Population-level smoke thresholds the script enforces on its own
// output. Hand-tightened against expected behaviour of the 50k sample;
// crossing these means the catalog has drifted measurably against
// SIMBAD, not that any one star is wrong. Exit code is non-zero when
// the median |absmag| residual or median |plx-sigma| residual crosses.
export const RESIDUAL_THRESHOLDS = {
  absmagMedian: 0.1,        // |median catalog − simbad| absmag
  plxSigmaMedian: 3,        // |median plx-residual / plx_err|
  outlierFractionWarn: 0.01, // surfaced in report, not gate
} as const;

// Per-star outlier criteria (bead spec): a star is flagged when either
// its absmag residual exceeds half a magnitude OR its parallax residual
// is beyond 3-sigma of SIMBAD's published plx_err. Either failure mode
// is suspicious independent of the other.
export const PER_STAR_OUTLIER = {
  absmagAbs: 0.5,
  plxSigmaAbs: 3,
} as const;

export const OUTLIER_TOP_N = 50;

// ─── Pure helpers (tested in validate-simbad-sample.test.ts) ─────────

export interface ResidualRow {
  simbadMainId: string;
  matchedBy: 'gaia' | 'hip';
  catalogAbsmag: number;
  simbadAbsmag: number;
  absmagResidual: number;
  catalogDistance: number;
  simbadDistance: number;
  catalogPlxMas: number;
  simbadPlxMas: number;
  simbadPlxErrMas: number | null;
  plxResidualSigma: number | null;
  distanceLogRatio: number;
  isOutlier: boolean;
}

export interface MatchStats {
  sampleRows: number;
  matchedByGaia: number;
  matchedByHip: number;
  unmatched: number;
  usable: number;
}

export interface PercentileStats {
  n: number;
  median: number;
  p10: number;
  p90: number;
  absP50: number;
  absP95: number;
  absP99: number;
}

/** O(n log n) sort-then-index quantile. Returns NaN when `values` is
 *  empty so callers can branch cleanly. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function summarise(values: readonly number[]): PercentileStats {
  const abs = values.map((v) => Math.abs(v));
  return {
    n: values.length,
    median: quantile(values, 0.5),
    p10: quantile(values, 0.1),
    p90: quantile(values, 0.9),
    absP50: quantile(abs, 0.5),
    absP95: quantile(abs, 0.95),
    absP99: quantile(abs, 0.99),
  };
}

/** Fixed-width histogram with explicit range; values outside [lo, hi]
 *  collect at the boundary bins, so callers see clipping rather than
 *  silent drop. Returns bin counts and the left edge of each bin. */
export function histogram(
  values: readonly number[],
  binCount: number,
  range: readonly [number, number],
): { counts: number[]; edges: number[] } {
  const [lo, hi] = range;
  if (binCount <= 0 || !(hi > lo)) {
    throw new Error('histogram: binCount must be > 0 and hi > lo');
  }
  const width = (hi - lo) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  const edges = new Array<number>(binCount);
  for (let i = 0; i < binCount; i++) edges[i] = lo + i * width;
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    else if (idx >= binCount) idx = binCount - 1;
    counts[idx] += 1;
  }
  return { counts, edges };
}

/** ASCII bar chart for the markdown report. Bars are scaled to the
 *  max-count column so the visual range survives skewed distributions. */
export function renderHistogram(
  counts: readonly number[],
  edges: readonly number[],
  barWidth = 40,
): string {
  const max = counts.reduce((m, c) => Math.max(m, c), 0);
  if (max === 0) return '(no samples in range)';
  const width = edges.length > 1 ? edges[1] - edges[0] : 0;
  const labelLen = Math.max(
    ...edges.map((e) => (e + width).toFixed(3).length),
    (edges[0]).toFixed(3).length,
  );
  const lines: string[] = [];
  for (let i = 0; i < counts.length; i++) {
    const bar = '█'.repeat(Math.round((counts[i] / max) * barWidth));
    const lo = edges[i].toFixed(3).padStart(labelLen);
    const hi = (edges[i] + width).toFixed(3).padStart(labelLen);
    lines.push(`  [${lo}, ${hi})  ${bar} ${counts[i]}`);
  }
  return lines.join('\n');
}

export function computeResidual(
  row: SimbadSampleRow,
  record: CatalogRecord,
  matchedBy: 'gaia' | 'hip',
): ResidualRow | null {
  if (row.absmag === null || row.distancePc === null || row.distancePc <= 0) {
    return null;
  }
  const catalogDistance = distancePc(record);
  if (!Number.isFinite(catalogDistance) || catalogDistance <= 0) return null;
  const absmagResidual = record.absmag - row.absmag;
  const catalogPlxMas = 1000 / catalogDistance;
  const simbadPlxMas = row.plxValue ?? 1000 / row.distancePc;
  const plxResidualSigma =
    row.plxErr !== null && row.plxErr > 0
      ? (catalogPlxMas - simbadPlxMas) / row.plxErr
      : null;
  const distanceLogRatio = Math.log10(catalogDistance / row.distancePc);
  const isOutlier =
    Math.abs(absmagResidual) > PER_STAR_OUTLIER.absmagAbs ||
    (plxResidualSigma !== null &&
      Math.abs(plxResidualSigma) > PER_STAR_OUTLIER.plxSigmaAbs);
  return {
    simbadMainId: row.simbadMainId,
    matchedBy,
    catalogAbsmag: record.absmag,
    simbadAbsmag: row.absmag,
    absmagResidual,
    catalogDistance,
    simbadDistance: row.distancePc,
    catalogPlxMas,
    simbadPlxMas,
    simbadPlxErrMas: row.plxErr,
    plxResidualSigma,
    distanceLogRatio,
    isOutlier,
  };
}

export interface ResidualReport {
  generatedAt: string;
  matchStats: MatchStats;
  absmagStats: PercentileStats;
  distanceLogRatioStats: PercentileStats;
  plxSigmaStats: PercentileStats;
  absmagHistogram: { counts: number[]; edges: number[] };
  distanceLogRatioHistogram: { counts: number[]; edges: number[] };
  topOutliers: ResidualRow[];
  outlierCount: number;
}

export function buildReport(
  rows: readonly ResidualRow[],
  matchStats: MatchStats,
  generatedAt: string,
): ResidualReport {
  const absmagVals = rows.map((r) => r.absmagResidual);
  const logRatioVals = rows.map((r) => r.distanceLogRatio);
  const plxSigmaVals = rows
    .map((r) => r.plxResidualSigma)
    .filter((v): v is number => v !== null);
  const outliers = rows.filter((r) => r.isOutlier);
  const topOutliers = [...outliers]
    .sort((a, b) => Math.abs(b.absmagResidual) - Math.abs(a.absmagResidual))
    .slice(0, OUTLIER_TOP_N);
  return {
    generatedAt,
    matchStats,
    absmagStats: summarise(absmagVals),
    distanceLogRatioStats: summarise(logRatioVals),
    plxSigmaStats: summarise(plxSigmaVals),
    absmagHistogram: histogram(absmagVals, 40, [-1, 1]),
    distanceLogRatioHistogram: histogram(logRatioVals, 40, [-1, 1]),
    topOutliers,
    outlierCount: outliers.length,
  };
}

export function formatReport(report: ResidualReport): string {
  const m = report.matchStats;
  const matchedPct = m.sampleRows > 0
    ? ((m.matchedByGaia + m.matchedByHip) / m.sampleRows) * 100
    : 0;
  const outlierPct = m.usable > 0 ? (report.outlierCount / m.usable) * 100 : 0;
  const lines: string[] = [];
  lines.push('# SIMBAD validation residuals');
  lines.push('');
  lines.push(
    `Generated ${report.generatedAt} by `
    + '`npm run validate:simbad`. Compares Stellata\'s `catalog.bin` '
    + 'absmag and distance against SIMBAD published values for the '
    + 'sample in `data/simbad/simbad_sample.tsv`.',
  );
  lines.push('');
  lines.push('## Match coverage');
  lines.push('');
  lines.push(`- Sample rows: ${m.sampleRows}`);
  lines.push(`- Matched: ${m.matchedByGaia + m.matchedByHip} (${matchedPct.toFixed(2)} %)`);
  lines.push(`  - via Gaia source_id: ${m.matchedByGaia}`);
  lines.push(`  - via HIP fallback: ${m.matchedByHip}`);
  lines.push(`- Unmatched: ${m.unmatched}`);
  lines.push(`- Usable for residuals (matched ∧ absmag ∧ distance present): ${m.usable}`);
  lines.push('');
  lines.push(formatStatsSection('Absmag residual (catalog − simbad)', report.absmagStats, report.absmagHistogram));
  lines.push('');
  lines.push(formatStatsSection('Distance log-ratio (log10 catalog / simbad)', report.distanceLogRatioStats, report.distanceLogRatioHistogram));
  lines.push('');
  lines.push('## Parallax residual (sigma units)');
  lines.push('');
  lines.push(formatStatsTable(report.plxSigmaStats));
  lines.push('');
  lines.push(`## Top-${OUTLIER_TOP_N} outliers (by |Δabsmag|)`);
  lines.push('');
  lines.push(`Outlier criteria: |Δabsmag| > ${PER_STAR_OUTLIER.absmagAbs} OR |plx residual / plx_err| > ${PER_STAR_OUTLIER.plxSigmaAbs}.`);
  lines.push(`Total outliers: ${report.outlierCount} of ${m.usable} (${outlierPct.toFixed(2)} %).`);
  lines.push('');
  lines.push('| simbad_main_id | matched | catalog absmag | simbad absmag | Δabsmag | catalog dist (pc) | simbad dist (pc) | plx σ |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of report.topOutliers) {
    const sigma = r.plxResidualSigma === null ? '—' : r.plxResidualSigma.toFixed(2);
    lines.push(
      `| ${r.simbadMainId} | ${r.matchedBy} | ${r.catalogAbsmag.toFixed(3)} | `
        + `${r.simbadAbsmag.toFixed(3)} | ${r.absmagResidual.toFixed(3)} | `
        + `${r.catalogDistance.toFixed(2)} | ${r.simbadDistance.toFixed(2)} | ${sigma} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function formatStatsSection(
  title: string,
  stats: PercentileStats,
  hist: { counts: number[]; edges: number[] },
): string {
  return [
    `## ${title}`,
    '',
    formatStatsTable(stats),
    '',
    'Histogram (bin = 0.05, range [-1, +1]; out-of-range collects at boundary):',
    '',
    '```',
    renderHistogram(hist.counts, hist.edges),
    '```',
  ].join('\n');
}

function formatStatsTable(stats: PercentileStats): string {
  return [
    '| stat | value |',
    '| --- | ---: |',
    `| n | ${stats.n} |`,
    `| median | ${stats.median.toFixed(4)} |`,
    `| p10 | ${stats.p10.toFixed(4)} |`,
    `| p90 | ${stats.p90.toFixed(4)} |`,
    `| abs p50 | ${stats.absP50.toFixed(4)} |`,
    `| abs p95 | ${stats.absP95.toFixed(4)} |`,
    `| abs p99 | ${stats.absP99.toFixed(4)} |`,
  ].join('\n');
}

export function checkThresholds(report: ResidualReport): string[] {
  const failures: string[] = [];
  if (Math.abs(report.absmagStats.median) > RESIDUAL_THRESHOLDS.absmagMedian) {
    failures.push(
      `median absmag residual ${report.absmagStats.median.toFixed(4)} `
        + `exceeds threshold ±${RESIDUAL_THRESHOLDS.absmagMedian}`,
    );
  }
  if (
    report.plxSigmaStats.n > 0
    && Math.abs(report.plxSigmaStats.median) > RESIDUAL_THRESHOLDS.plxSigmaMedian
  ) {
    failures.push(
      `median |plx residual / err| ${report.plxSigmaStats.median.toFixed(2)}σ `
        + `exceeds threshold ${RESIDUAL_THRESHOLDS.plxSigmaMedian}σ`,
    );
  }
  return failures;
}

// ─── Match driver ────────────────────────────────────────────────────

function lookupRow(
  catalog: Catalog,
  row: SimbadSampleRow,
): { record: CatalogRecord; matchedBy: 'gaia' | 'hip' } | null {
  if (row.gaiaSourceId) {
    const r = lookupByGaiaSourceId(catalog, row.gaiaSourceId);
    if (r) return { record: r, matchedBy: 'gaia' };
  }
  if (row.hip !== null) {
    const r = lookupByHip(catalog, row.hip);
    if (r) return { record: r, matchedBy: 'hip' };
  }
  return null;
}

interface RunOptions {
  samplePath?: string;
  reportPath?: string;
  catalogBinPath?: string;
}

export async function runValidation(opts: RunOptions = {}): Promise<{
  report: ResidualReport;
  failures: string[];
}> {
  const samplePath = opts.samplePath ?? DEFAULT_SAMPLE_PATH;
  const reportPath = opts.reportPath ?? DEFAULT_REPORT_PATH;
  const sample = parseSimbadSampleRows(readFileSync(samplePath, 'utf8'));
  const catalog = await loadCatalog({ catalogBinPath: opts.catalogBinPath });

  const residuals: ResidualRow[] = [];
  let matchedByGaia = 0;
  let matchedByHip = 0;
  let unmatched = 0;
  for (const row of sample) {
    const hit = lookupRow(catalog, row);
    if (!hit) {
      unmatched += 1;
      continue;
    }
    if (hit.matchedBy === 'gaia') matchedByGaia += 1;
    else matchedByHip += 1;
    const residual = computeResidual(row, hit.record, hit.matchedBy);
    if (residual) residuals.push(residual);
  }

  const matchStats: MatchStats = {
    sampleRows: sample.length,
    matchedByGaia,
    matchedByHip,
    unmatched,
    usable: residuals.length,
  };
  const report = buildReport(residuals, matchStats, new Date().toISOString());
  const failures = checkThresholds(report);

  writeFileSync(reportPath, formatReport(report), 'utf8');
  return { report, failures };
}

// CLI entrypoint — only runs when this file is the process's main
// module, so the test file can import the pure helpers without firing
// the catalog load.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isMain) {
  runValidation()
    .then(({ report, failures }) => {
      const m = report.matchStats;
      console.log(
        `validate-simbad: ${m.usable} usable rows; `
          + `absmag median=${report.absmagStats.median.toFixed(4)} `
          + `abs95=${report.absmagStats.absP95.toFixed(3)}; `
          + `distance logRatio median=${report.distanceLogRatioStats.median.toFixed(4)}; `
          + `plx σ median=${report.plxSigmaStats.median.toFixed(2)}; `
          + `outliers=${report.outlierCount}`,
      );
      if (failures.length > 0) {
        console.error('FAIL — population thresholds tripped:');
        for (const f of failures) console.error(`  ${f}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('validate-simbad failed:', err);
      process.exit(2);
    });
}
