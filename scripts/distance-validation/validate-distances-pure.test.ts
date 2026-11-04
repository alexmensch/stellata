import { describe, expect, it } from 'vitest';

import {
  aggregateStats,
  buildReport,
  formatReport,
  fractionalDiff,
  passesAcceptanceBars,
  topNDisagreements,
  type Disagreement,
  type ValidationReport,
} from './validate-distances-pure';
import { ADOPTED_BJ_OLD, ADOPTED_EDSD_NEW, type Adopted, type VaidmanRow } from './vaidman-tsv';

describe('fractionalDiff', () => {
  it('is signed relative to the paper', () => {
    expect(fractionalDiff(110, 100)).toBeCloseTo(0.1, 12);
    expect(fractionalDiff(90, 100)).toBeCloseTo(-0.1, 12);
    expect(fractionalDiff(100, 100)).toBe(0);
  });

  it('is NaN for a non-positive paper distance', () => {
    expect(fractionalDiff(100, 0)).toBeNaN();
    expect(fractionalDiff(100, -5)).toBeNaN();
  });
});

describe('aggregateStats', () => {
  it('interpolates percentiles linearly over |diffs|', () => {
    const stats = aggregateStats([0.01, -0.04, 0.05, -0.1, 0.2]);
    expect(stats.count).toBe(5);
    expect(stats.median).toBeCloseTo(0.05, 12);
    expect(stats.max).toBeCloseTo(0.2, 12);
    expect(stats.p84).toBeCloseTo(0.136, 12);
  });

  it('answers NaN for no values and the value itself for one', () => {
    expect(aggregateStats([])).toEqual({ median: NaN, p84: NaN, max: NaN, count: 0 });
    expect(aggregateStats([0.07])).toEqual({ median: 0.07, p84: 0.07, max: 0.07, count: 1 });
  });

  it('drops NaN inputs before sorting', () => {
    const stats = aggregateStats([0.1, NaN, -0.2, NaN, 0.3]);
    expect(stats.count).toBe(3);
    expect(stats.median).toBeCloseTo(0.2, 12);
    expect(aggregateStats([NaN, NaN]).count).toBe(0);
  });
});

const disagreement = (name: string, fracDiff: number): Disagreement => ({
  name, sourceId: '42', catalogPc: 100, paperPc: 110, fracDiff, snrTot: 8,
});

describe('topNDisagreements', () => {
  it('sorts by |frac diff| descending', () => {
    const items = [disagreement('A', 0.1), disagreement('B', -0.5), disagreement('C', 0.3), disagreement('D', -0.2)];
    expect(topNDisagreements(items, 3).map((d) => d.name)).toEqual(['B', 'C', 'D']);
  });
});

describe('formatReport', () => {
  const report = (unresolved: string[], large: number, median = 0.05): ValidationReport => ({
    edsd: {
      total: 10, compared: 8, unresolved,
      stats: { median, p84: 0.1, max: 0.6, count: 8 },
      large: Array(large).fill(disagreement('BIG', 0.6)),
      top: [disagreement('BIG', 0.6), disagreement('MED', 0.2)],
    },
    bj: { total: 2, compared: 2, unresolved: [], stats: { median: 0, p84: 0, max: 0, count: 2 }, top: [disagreement('SC', 0)] },
  });

  it('emits the stable headline markers', () => {
    const out = formatReport(report(['X', 'Y'], 1));
    expect(out).toContain('validate-distances: EDSD_new subset — compared 8/10');
    expect(out).toContain('validate-distances: EDSD_new unresolved (2): X, Y');
    expect(out).toContain('validate-distances: EDSD_new |frac diff|>50%: 1 (bar ≤ 5)');
    expect(out).toContain('validate-distances: EDSD_new top-5 disagreements:');
    expect(out).toContain('validate-distances: BJ_old subset (report-only) — compared 2/2');
  });

  it('formats a disagreement row in fixed columns', () => {
    expect(formatReport(report([], 0))).toContain(
      '    BIG            gaia=42  catalog=   100.00pc  paper=   110.00pc  frac diff= +60.0%  SNR=8.00',
    );
  });

  it('skips an empty unresolved line and renders NaN as n/a', () => {
    expect(formatReport(report([], 0))).not.toContain('EDSD_new unresolved');
    expect(formatReport(report([], 0, NaN))).toContain('median |frac diff|=n/a');
  });
});

describe('buildReport', () => {
  const ref = (name: string, sid: string, dBj: number, dNew: number, adopted: Adopted): VaidmanRow => ({
    name, gaiaSourceId: sid, dBjPaperPc: dBj, dNewPc: dNew, snrTot: 10, adopted,
    sigmaDBjPaperPc: 0, ruwe: 1, gMag: 8, sigmaDNewPc: 0, priorScalePc: 0,
  });

  it('compares each subset against its adopted distance and gates on the EDSD_new bars', () => {
    const refs = [
      ref('A', '1', 0, 100, ADOPTED_EDSD_NEW),
      ref('B', '2', 0, 100, ADOPTED_EDSD_NEW),
      ref('C', '3', 0, 100, ADOPTED_EDSD_NEW),
      ref('D', '4', 0, 100, ADOPTED_EDSD_NEW),
      ref('E', '99', 0, 100, ADOPTED_EDSD_NEW),
      ref('F', '5', 50, 0, ADOPTED_BJ_OLD),
      ref('G', '6', 80, 0, ADOPTED_BJ_OLD),
    ];
    const bj = new Map([['1', 105], ['2', 108], ['3', 112], ['4', 160], ['5', 50], ['6', 80]]);
    const report = buildReport(refs, bj);
    expect(report.edsd.total).toBe(5);
    expect(report.edsd.compared).toBe(4);
    expect(report.edsd.unresolved).toEqual(['E']);
    expect(report.edsd.stats.median).toBeCloseTo(0.1, 12);
    expect(report.edsd.large.map((d) => d.name)).toEqual(['D']);
    expect(report.bj.total).toBe(2);
    expect(report.bj.compared).toBe(2);
    expect(report.bj.stats.median).toBe(0);
    expect(passesAcceptanceBars(report)).toBe(true);
  });

  it('fails on too many large differences, and on a high median', () => {
    const six = Array.from({ length: 6 }, (_, i) => ref(`S${i}`, `${i}`, 0, 100, ADOPTED_EDSD_NEW));
    const far = buildReport(six, new Map(six.map((r) => [r.gaiaSourceId, 180])));
    expect(far.edsd.large).toHaveLength(6);
    expect(passesAcceptanceBars(far)).toBe(false);
    const off = buildReport(six.slice(0, 5), new Map(six.map((r) => [r.gaiaSourceId, 120])));
    expect(off.edsd.large).toHaveLength(0);
    expect(off.edsd.stats.median).toBeCloseTo(0.2, 12);
    expect(passesAcceptanceBars(off)).toBe(false);
  });
});
