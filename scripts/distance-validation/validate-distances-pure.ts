// The Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021) distances against Vaidman 2025 (/data/papers/index.md#vaidman2025): statistics, acceptance bars and the report. See README.md.

import { ADOPTED_BJ_OLD, ADOPTED_EDSD_NEW, type VaidmanRow } from './vaidman-tsv';

export const MEDIAN_FRAC_DIFF_MAX = 0.15;
export const LARGE_DIFF_THRESHOLD = 0.5;
export const LARGE_DIFF_COUNT_MAX = 5;
export const TOP_N_REPORTED = 5;

export interface Disagreement {
  readonly name: string;
  readonly sourceId: string;
  readonly catalogPc: number;
  readonly paperPc: number;
  readonly fracDiff: number;
  readonly snrTot: number;
}

export interface Stats {
  readonly median: number;
  readonly p84: number;
  readonly max: number;
  readonly count: number;
}

/** (catalog − paper) / paper; NaN for a non-positive paper distance. */
export function fractionalDiff(catalogPc: number, paperPc: number): number {
  return paperPc <= 0 ? Number.NaN : (catalogPc - paperPc) / paperPc;
}

/** Linear-interpolation percentile, p in [0, 100], of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Median, 84th percentile and max of |diffs|, NaN diffs dropped first. */
export function aggregateStats(diffs: readonly number[]): Stats {
  const abs = diffs.filter((d) => !Number.isNaN(d)).map(Math.abs).sort((a, b) => a - b);
  if (abs.length === 0) return { median: Number.NaN, p84: Number.NaN, max: Number.NaN, count: 0 };
  return { median: percentile(abs, 50), p84: percentile(abs, 84), max: abs[abs.length - 1], count: abs.length };
}

export function topNDisagreements(items: readonly Disagreement[], n = TOP_N_REPORTED): Disagreement[] {
  return [...items].sort((a, b) => Math.abs(b.fracDiff) - Math.abs(a.fracDiff)).slice(0, n);
}

interface Subset {
  readonly total: number;
  readonly compared: number;
  readonly unresolved: readonly string[];
  readonly stats: Stats;
  readonly top: readonly Disagreement[];
}

export interface ValidationReport {
  readonly edsd: Subset & { readonly large: readonly Disagreement[] };
  readonly bj: Subset;
}

/** EDSD_new rows compare against the paper's new distance and carry the acceptance bars; BJ_old rows
 *  compare against the paper's own Bailer-Jones distance and are report-only. A star whose source_id has
 *  no Bailer-Jones distance is unresolved. */
export function buildReport(refs: readonly VaidmanRow[], bjDistPc: ReadonlyMap<string, number>): ValidationReport {
  const subset = (adopted: string, paperPc: (r: VaidmanRow) => number) => {
    const rows = refs.filter((r) => r.adopted === adopted);
    const unresolved: string[] = [];
    const diffs: Disagreement[] = [];
    for (const r of rows) {
      const catalogPc = bjDistPc.get(r.gaiaSourceId);
      if (catalogPc === undefined) {
        unresolved.push(r.name);
        continue;
      }
      const paper = paperPc(r);
      diffs.push({
        name: r.name, sourceId: r.gaiaSourceId, catalogPc, paperPc: paper,
        fracDiff: fractionalDiff(catalogPc, paper), snrTot: r.snrTot,
      });
    }
    return {
      diffs,
      subset: {
        total: rows.length,
        compared: diffs.length,
        unresolved,
        stats: aggregateStats(diffs.map((d) => d.fracDiff)),
        top: topNDisagreements(diffs),
      },
    };
  };
  const edsd = subset(ADOPTED_EDSD_NEW, (r) => r.dNewPc);
  const bj = subset(ADOPTED_BJ_OLD, (r) => r.dBjPaperPc);
  return {
    edsd: { ...edsd.subset, large: edsd.diffs.filter((d) => Math.abs(d.fracDiff) > LARGE_DIFF_THRESHOLD) },
    bj: bj.subset,
  };
}

export function passesAcceptanceBars(report: ValidationReport): boolean {
  const { median } = report.edsd.stats;
  return !Number.isNaN(median) && median <= MEDIAN_FRAC_DIFF_MAX && report.edsd.large.length <= LARGE_DIFF_COUNT_MAX;
}

export function pct(x: number): string {
  return Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(2)}%`;
}

function signed(x: number, digits: number): string {
  return `${x < 0 || Object.is(x, -0) ? '-' : '+'}${Math.abs(x).toFixed(digits)}`;
}

function formatDisagreement(d: Disagreement): string {
  return `${d.name.padEnd(14)} gaia=${d.sourceId}  `
    + `catalog=${d.catalogPc.toFixed(2).padStart(9)}pc  paper=${d.paperPc.toFixed(2).padStart(9)}pc  `
    + `frac diff=${signed(d.fracDiff * 100, 1).padStart(6)}%  SNR=${d.snrTot.toFixed(2)}`;
}

/** Its `validate-distances:` headline lines are stable identifiers a downstream grep relies on. */
export function formatReport(report: ValidationReport): string {
  const { edsd, bj } = report;
  const lines = [
    `validate-distances: EDSD_new subset — compared ${edsd.compared}/${edsd.total} `
      + `(median |frac diff|=${pct(edsd.stats.median)}, p84=${pct(edsd.stats.p84)}, max=${pct(edsd.stats.max)})`,
    ...(edsd.unresolved.length > 0
      ? [`validate-distances: EDSD_new unresolved (${edsd.unresolved.length}): ${edsd.unresolved.join(', ')}`]
      : []),
    `validate-distances: EDSD_new |frac diff|>50%: ${edsd.large.length} (bar ≤ ${LARGE_DIFF_COUNT_MAX})`,
    `validate-distances: EDSD_new top-${TOP_N_REPORTED} disagreements:`,
    ...edsd.top.map((d) => `    ${formatDisagreement(d)}`),
    '',
    `validate-distances: BJ_old subset (report-only) — compared ${bj.compared}/${bj.total} `
      + `(median |frac diff|=${pct(bj.stats.median)}, max=${pct(bj.stats.max)})`,
    ...(bj.unresolved.length > 0
      ? [`validate-distances: BJ_old unresolved (${bj.unresolved.length}): ${bj.unresolved.join(', ')}`]
      : []),
    ...bj.top.map((d) => `    ${formatDisagreement(d)}`),
  ];
  return lines.join('\n');
}
