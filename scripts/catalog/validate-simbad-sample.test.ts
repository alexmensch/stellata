import { describe, it, expect } from 'vitest';

import {
  HISTOGRAM_RANGE,
  PER_STAR_OUTLIER,
  RESIDUAL_THRESHOLDS,
  buildReport,
  checkThresholds,
  computeResidual,
  formatReport,
  histogram,
  quantile,
  renderHistogram,
  summarise,
  type MatchStats,
  type ResidualRow,
} from './validate-simbad-sample';
import type { CatalogRecord } from './catalog-lookup';
import type { SimbadSampleRow } from './simbad-sample-parse';

function makeRecord(over: Partial<CatalogRecord>): CatalogRecord {
  return {
    i: 0,
    x: 10, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    absmag: 4.0,
    ci: 0,
    physicalRadius: 1,
    companion: null,
    spectClass: 0,
    lumClass: 5,
    conIndex: 0,
    flags: 0,
    amplitudeMag: 0,
    periodDays: 0,
    varType: 0,
    hip: null,
    gaiaSourceId: null,
    multiplicityStatus: 0,
    teffGspphot: null,
    loggGspphot: null,
    mhGspphot: null,
    azeroGspphot: null,
    teffGspspec: null,
    loggGspspec: null,
    mhGspspec: null,
    name: null,
    conCode: null,
    ...over,
  };
}

function makeRow(over: Partial<SimbadSampleRow>): SimbadSampleRow {
  return {
    simbadOid: 1,
    simbadMainId: 'TST 1',
    hip: 1,
    gaiaSourceId: '100',
    plxValue: 100,
    plxErr: 0.5,
    pmra: 0,
    pmdec: 0,
    vMag: 5,
    distancePc: 10,
    absmag: 4.0,
    ...over,
  };
}

describe('quantile', () => {
  it('returns the indexed value at q=0 and q=1', () => {
    expect(quantile([3, 1, 2], 0)).toBe(1);
    expect(quantile([3, 1, 2], 1)).toBe(3);
  });

  it('linearly interpolates between samples', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 9);
  });

  it('returns NaN on empty input', () => {
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe('summarise', () => {
  it('reports median, percentiles, and abs-magnitude stats', () => {
    const stats = summarise([-2, -1, 0, 1, 2]);
    expect(stats.n).toBe(5);
    expect(stats.median).toBe(0);
    expect(stats.p10).toBeCloseTo(-1.6, 9);
    expect(stats.p90).toBeCloseTo(1.6, 9);
    expect(stats.absP50).toBe(1);
    expect(stats.absP95).toBeCloseTo(2, 9);
  });

  it('emits NaN summary fields when empty', () => {
    const stats = summarise([]);
    expect(stats.n).toBe(0);
    expect(Number.isNaN(stats.median)).toBe(true);
  });
});

describe('histogram', () => {
  it('counts values into fixed-width bins', () => {
    const { counts, edges } = histogram([0.0, 0.1, 0.4, 0.5, 0.9], 10, [0, 1]);
    expect(counts).toHaveLength(10);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(edges[0]).toBe(0);
    expect(edges[1]).toBeCloseTo(0.1, 9);
  });

  it('clips out-of-range values into the boundary bins', () => {
    const { counts } = histogram([-99, 99], 4, [0, 1]);
    expect(counts[0]).toBe(1);
    expect(counts[counts.length - 1]).toBe(1);
  });

  it('rejects invalid range or zero bin count', () => {
    expect(() => histogram([], 0, [0, 1])).toThrow();
    expect(() => histogram([], 4, [1, 0])).toThrow();
  });
});

describe('renderHistogram', () => {
  it('emits one line per bin with a scaled bar', () => {
    const out = renderHistogram([0, 4, 2, 0], [0, 1, 2, 3], 4);
    const lines = out.split('\n');
    expect(lines).toHaveLength(4);
    expect(out).toMatch(/█/);
  });

  it('reports an empty-marker when nothing is in range', () => {
    expect(renderHistogram([0, 0, 0], [0, 1, 2])).toMatch(/no samples/);
  });
});

describe('computeResidual', () => {
  it('returns residual fields for a matched row', () => {
    const row = makeRow({ absmag: 4.0, distancePc: 10, plxValue: 100, plxErr: 0.5 });
    const rec = makeRecord({ absmag: 4.1, x: 10, y: 0, z: 0 });
    const res = computeResidual(row, rec, 'gaia');
    expect(res).not.toBeNull();
    expect(res!.absmagResidual).toBeCloseTo(0.1, 9);
    expect(res!.catalogDistance).toBe(10);
    expect(res!.distanceLogRatio).toBeCloseTo(0, 9);
    expect(res!.plxResidualSigma).toBeCloseTo(0, 9);
    expect(res!.isOutlier).toBe(false);
  });

  it('flags isOutlier when |Δabsmag| exceeds the per-star threshold', () => {
    const row = makeRow({ absmag: 4.0 });
    const rec = makeRecord({ absmag: 4.0 + PER_STAR_OUTLIER.absmagAbs + 0.01 });
    const res = computeResidual(row, rec, 'gaia');
    expect(res!.isOutlier).toBe(true);
  });

  it('flags isOutlier on parallax sigma even when absmag is fine', () => {
    const row = makeRow({ absmag: 4.0, plxValue: 100, plxErr: 0.5, distancePc: 10 });
    // catalog plx = 1000 / 5 = 200 mas; sigma = (200 - 100) / 0.5 = 200σ
    const rec = makeRecord({ absmag: 4.0, x: 5, y: 0, z: 0 });
    const res = computeResidual(row, rec, 'gaia');
    expect(res!.isOutlier).toBe(true);
    expect(res!.plxResidualSigma!).toBeGreaterThan(PER_STAR_OUTLIER.plxSigmaAbs);
  });

  it('skips rows missing absmag or distance', () => {
    expect(computeResidual(makeRow({ absmag: null }), makeRecord({}), 'gaia')).toBeNull();
    expect(computeResidual(makeRow({ distancePc: null }), makeRecord({}), 'gaia')).toBeNull();
  });

  it('leaves plxResidualSigma null when plx_err is missing', () => {
    const row = makeRow({ plxErr: null });
    const res = computeResidual(row, makeRecord({}), 'gaia');
    expect(res!.plxResidualSigma).toBeNull();
  });
});

describe('buildReport', () => {
  it('aggregates residuals, outliers, and histograms', () => {
    const rows: ResidualRow[] = [
      mkResidual({ absmagResidual: -0.05, isOutlier: false }),
      mkResidual({ absmagResidual: 0.05, isOutlier: false }),
      mkResidual({ absmagResidual: 1.0, isOutlier: true }),
    ];
    const matchStats: MatchStats = {
      sampleRows: 10,
      matchedByGaia: 3,
      matchedByHip: 0,
      unmatched: 7,
      usable: rows.length,
    };
    const report = buildReport(rows, matchStats, '2026-05-22T00:00:00Z');
    expect(report.absmagStats.n).toBe(3);
    expect(report.outlierCount).toBe(1);
    expect(report.topOutliers).toHaveLength(1);
    expect(report.absmagHistogram.counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('top-outlier ordering is by |Δabsmag| descending', () => {
    const rows: ResidualRow[] = [
      mkResidual({ simbadMainId: 'small', absmagResidual: 0.6, isOutlier: true }),
      mkResidual({ simbadMainId: 'huge', absmagResidual: -2.0, isOutlier: true }),
      mkResidual({ simbadMainId: 'medium', absmagResidual: 1.0, isOutlier: true }),
    ];
    const report = buildReport(rows, emptyStats(rows.length), 'now');
    expect(report.topOutliers.map((r) => r.simbadMainId)).toEqual(['huge', 'medium', 'small']);
  });
});

describe('checkThresholds', () => {
  it('fails when median absmag residual crosses the smoke threshold', () => {
    const report = buildReport(
      Array.from({ length: 5 }, () => mkResidual({ absmagResidual: RESIDUAL_THRESHOLDS.absmagMedian + 0.01 })),
      emptyStats(5),
      'now',
    );
    const failures = checkThresholds(report);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/absmag/);
  });

  it('passes when residuals stay inside the smoke envelope', () => {
    const report = buildReport(
      [mkResidual({ absmagResidual: 0.01, plxResidualSigma: 0.1 })],
      emptyStats(1),
      'now',
    );
    expect(checkThresholds(report)).toEqual([]);
  });
});

describe('formatReport', () => {
  it('lists outlier rows in the markdown table', () => {
    const report = buildReport(
      [mkResidual({ simbadMainId: 'V* HOTONE', absmagResidual: 1.2, isOutlier: true })],
      emptyStats(1),
      '2026-05-22T00:00:00Z',
    );
    const md = formatReport(report);
    expect(md).toMatch(/SIMBAD validation residuals/);
    expect(md).toMatch(/V\* HOTONE/);
    expect(md).toMatch(/Top-50 outliers/);
  });

  it('derives the histogram bin width from the edges, not a hard-coded literal', () => {
    const report = buildReport([mkResidual({})], emptyStats(1), 'now');
    expect(formatReport(report)).toMatch(/bin = 0\.05, range \[-1, \+1\]/);

    const rebinned = {
      ...report,
      absmagHistogram: histogram([0], 80, HISTOGRAM_RANGE),
      distanceLogRatioHistogram: histogram([0], 80, HISTOGRAM_RANGE),
    };
    expect(formatReport(rebinned)).toMatch(/bin = 0\.025, range \[-1, \+1\]/);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

function mkResidual(over: Partial<ResidualRow>): ResidualRow {
  return {
    simbadMainId: 'X',
    matchedBy: 'gaia',
    catalogAbsmag: 4.0,
    simbadAbsmag: 4.0,
    absmagResidual: 0,
    catalogDistance: 10,
    simbadDistance: 10,
    catalogPlxMas: 100,
    simbadPlxMas: 100,
    simbadPlxErrMas: 0.5,
    plxResidualSigma: 0,
    distanceLogRatio: 0,
    isOutlier: false,
    ...over,
  };
}

function emptyStats(n: number): MatchStats {
  return { sampleRows: n, matchedByGaia: n, matchedByHip: 0, unmatched: 0, usable: n };
}
