import { describe, it, expect } from 'vitest';

import type { Star } from '../parse/stars-parse';
import { makeStar } from '../parse/star-fixture';
import {
  SELF_CONSISTENCY_THRESHOLDS,
  SIMBAD_DISTANCE_THRESHOLD,
  buildRegressionReport,
  compareRegressionReports,
  detectSelfConsistencyOutlier,
  detectSimbadOutlier,
  finalDistance,
  formatRegressionDiff,
  mergeReasonsFromSnapshot,
  parseSimbadSampleTsv,
  starKey,
  type RegressionReport,
  type SimbadDistanceEntry,
} from './distance-regression-check';

// Place a star at (d, 0, 0) so finalDistance(star) === d.
function starAt(d: number, overrides: Partial<Star> = {}): Star {
  return makeStar({ x: d, y: 0, z: 0, ...overrides });
}

describe('starKey + finalDistance', () => {
  it('prefers gaia source_id over hip', () => {
    expect(starKey({ gaiaSourceId: '123', hip: 456 })).toBe('gaia:123');
  });
  it('falls back to hip when gaia is absent', () => {
    expect(starKey({ gaiaSourceId: null, hip: 456 })).toBe('hip:456');
  });
  it('returns null when both are absent', () => {
    expect(starKey({ gaiaSourceId: null, hip: null })).toBe(null);
  });
  it('computes Euclidean magnitude', () => {
    expect(finalDistance({ x: 3, y: 4, z: 0 })).toBe(5);
    expect(finalDistance({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe('threshold constants', () => {
  it('holds every measured non-Gaia tier strictly (factor 3)', () => {
    for (const tier of [
      'hip2_parallax', 'cns5_plx', 'gliese_plx', 'simbad_plx',
      'pair_member_parallax', 'gliese_photometric_plx',
    ] as const) {
      expect(SELF_CONSISTENCY_THRESHOLDS[tier], tier).toBeCloseTo(Math.log10(3), 10);
    }
  });
  it('holds the Gaia inversion loosely (factor 30) — Bailer-Jones territory', () => {
    expect(SELF_CONSISTENCY_THRESHOLDS.gaia_dr3_inversion).toBeCloseTo(Math.log10(30), 10);
  });
  it('has no opinion on the override layers, Sol or a park', () => {
    expect(SELF_CONSISTENCY_THRESHOLDS.bailer_jones).toBeUndefined();
    expect(SELF_CONSISTENCY_THRESHOLDS.lmc_kinematic).toBeUndefined();
    expect(SELF_CONSISTENCY_THRESHOLDS.curated).toBeUndefined();
    expect(SELF_CONSISTENCY_THRESHOLDS.none).toBeUndefined();
  });
  it('uses factor-5 for SIMBAD cross-check', () => {
    expect(SIMBAD_DISTANCE_THRESHOLD).toBeCloseTo(Math.log10(5), 10);
  });
});

describe('detectSelfConsistencyOutlier', () => {
  it('trips on a HIP2-tier star shifted ~60× from its own inversion', () => {
    const star = starAt(18_500, {
      hip: 25097,
      plxDistPc: 305,
      plxVia: 'hip2_parallax',
    });
    const o = detectSelfConsistencyOutlier(star);
    expect(o).not.toBeNull();
    expect(o!.id).toBe('hip:25097');
    expect(o!.plxVia).toBe('hip2_parallax');
    expect(o!.plxDist).toBe(305);
    expect(o!.finalDist).toBe(18_500);
    // log10(18500 / 305) ≈ 1.783
    expect(o!.logRatio).toBeCloseTo(1.783, 2);
  });

  it('passes a Gaia inversion shifted 5× — Bailer-Jones override territory', () => {
    const star = starAt(2500, {
      gaiaSourceId: '1234567890',
      plxDistPc: 500,
      plxVia: 'gaia_dr3_inversion',
    });
    expect(detectSelfConsistencyOutlier(star)).toBeNull();
  });

  it('trips on a Gaia inversion shifted 50× — beyond catastrophic-inversion tolerance', () => {
    const star = starAt(25_000, {
      gaiaSourceId: '9876543210',
      plxDistPc: 500,
      plxVia: 'gaia_dr3_inversion',
    });
    const o = detectSelfConsistencyOutlier(star);
    expect(o).not.toBeNull();
    expect(o!.plxVia).toBe('gaia_dr3_inversion');
  });

  it('skips rows whose tier has no threshold opinion', () => {
    const star = starAt(18_500, {
      hip: 12345,
      plxDistPc: 305,
      plxVia: 'curated',
    });
    expect(detectSelfConsistencyOutlier(star)).toBeNull();
  });

  it('skips rows with no inversion of their own — minted companions', () => {
    const star = starAt(300, {
      hip: 12345,
      plxDistPc: null,
      plxVia: null,
    });
    expect(detectSelfConsistencyOutlier(star)).toBeNull();
  });

  it('skips rows with no join key', () => {
    const star = starAt(18_500, {
      hip: null,
      gaiaSourceId: null,
      plxDistPc: 305,
      plxVia: 'hip2_parallax',
    });
    expect(detectSelfConsistencyOutlier(star)).toBeNull();
  });

  it('catches inward shifts (final < inversion) symmetrically', () => {
    // A HIP2 star whose parallax says 1000 pc, shipped at 100 pc (factor 10 inward).
    const star = starAt(100, {
      hip: 99999,
      plxDistPc: 1000,
      plxVia: 'hip2_parallax',
    });
    const o = detectSelfConsistencyOutlier(star);
    expect(o).not.toBeNull();
    expect(o!.logRatio).toBeLessThan(0);
  });
});

describe('detectSimbadOutlier', () => {
  function sampleWith(entry: SimbadDistanceEntry, key: string): Map<string, SimbadDistanceEntry> {
    return new Map([[key, entry]]);
  }

  it('trips at factor 5+ vs the SIMBAD sample', () => {
    const sample = sampleWith(
      { simbadOid: 999, simbadMainId: '* alf Cas', distancePc: 100 },
      'gaia:42',
    );
    const star = starAt(600, { gaiaSourceId: '42' }); // 6× away
    const o = detectSimbadOutlier(star, sample);
    expect(o).not.toBeNull();
    expect(o!.simbadDist).toBe(100);
    expect(o!.finalDist).toBe(600);
    expect(o!.simbadMainId).toBe('* alf Cas');
  });

  it('passes within the [1/5, 5] band', () => {
    const sample = sampleWith(
      { simbadOid: 999, simbadMainId: '* x y', distancePc: 100 },
      'gaia:42',
    );
    expect(detectSimbadOutlier(starAt(400, { gaiaSourceId: '42' }), sample)).toBeNull();
    expect(detectSimbadOutlier(starAt(25,  { gaiaSourceId: '42' }), sample)).toBeNull();
  });

  it('falls back to hip key when gaia is absent', () => {
    const sample = sampleWith(
      { simbadOid: 1, simbadMainId: 'HIP 25097', distancePc: 305 },
      'hip:25097',
    );
    const star = starAt(18_500, { hip: 25097, gaiaSourceId: null });
    const o = detectSimbadOutlier(star, sample);
    expect(o).not.toBeNull();
    expect(o!.id).toBe('hip:25097');
  });

  it('returns null for stars not in the sample', () => {
    const sample = new Map<string, SimbadDistanceEntry>();
    const star = starAt(18_500, { hip: 25097 });
    expect(detectSimbadOutlier(star, sample)).toBeNull();
  });

  it('never checks a distance the SIMBAD tier supplied — a value cannot '
    + 'verify itself', () => {
    const sample = sampleWith(
      { simbadOid: 999, simbadMainId: '* alf Cas', distancePc: 100 },
      'gaia:42',
    );
    // Same 6× disagreement the first case trips on: only the tier differs.
    const star = starAt(600, { gaiaSourceId: '42', distVia: 'simbad_plx' });
    expect(detectSimbadOutlier(star, sample)).toBeNull();
  });
});

describe('parseSimbadSampleTsv', () => {
  const HEADER =
    'simbad_oid\tsimbad_main_id\thip\tgaia_source_id\tra\tdec\tplx_value\tplx_err\tpmra\tpmdec\tv_mag\tdistance_pc\tabsmag\tsp_type\totype';

  it('populates both gaia and hip keys per row', () => {
    const tsv =
      `${HEADER}\n` +
      '23\tHD 199873\t\t1871565916603844224\t314.67\t36.98\t2.0625\t0.0147\t-5.18\t-2.05\t8.86\t484.848\t0.432\tA2\t*\n';
    const map = parseSimbadSampleTsv(tsv);
    expect(map.size).toBe(1);
    expect(map.get('gaia:1871565916603844224')?.distancePc).toBe(484.848);
  });

  it('keys by both gaia and hip when present', () => {
    const tsv =
      `${HEADER}\n` +
      '65\tHD 201252\t104242\t1868786041970250368\t316.80\t36.95\t1.39\t0.03\t3.0\t0.33\t8.18\t718.907\t-1.10\tA0\t*\n';
    const map = parseSimbadSampleTsv(tsv);
    expect(map.size).toBe(2);
    expect(map.get('hip:104242')?.simbadOid).toBe(65);
    expect(map.get('gaia:1868786041970250368')?.simbadOid).toBe(65);
  });

  it('skips rows with no usable distance', () => {
    const tsv =
      `${HEADER}\n` +
      '11\t* eps Cas\t\t1234\t0\t0\t\t\t\t\t6.0\t\t\tB\t*\n';
    const map = parseSimbadSampleTsv(tsv);
    expect(map.size).toBe(0);
  });

  it('throws on a missing required column', () => {
    expect(() => parseSimbadSampleTsv('simbad_oid\thip\n1\t100\n')).toThrow(
      /missing required column/,
    );
  });
});

const hip2Outlier = (id: number, plxDist: number, finalDist: number, logRatio: number) => ({
  id: `hip:${id}`, plxVia: 'hip2_parallax' as const, plxDist, finalDist, logRatio,
});

describe('buildRegressionReport', () => {
  it('returns empty arrays for an outlier-free catalog', () => {
    const stars = [
      starAt(300, { hip: 1, plxDistPc: 305, plxVia: 'hip2_parallax' }),
      starAt(2000, { gaiaSourceId: '9', plxDistPc: 500, plxVia: 'gaia_dr3_inversion' }),
    ];
    const report = buildRegressionReport(stars, new Map());
    expect(report.selfConsistency).toEqual([]);
    expect(report.simbad).toEqual([]);
  });

  it('runs SIMBAD check against an empty sample without crashing', () => {
    const stars = [
      starAt(18_500, { hip: 25097, plxDistPc: 305, plxVia: 'hip2_parallax' }),
    ];
    const report = buildRegressionReport(stars, new Map());
    expect(report.selfConsistency).toHaveLength(1);
    expect(report.simbad).toEqual([]);
  });

  it('emits both halves and sorts by id', () => {
    const stars = [
      starAt(18_500, { hip: 25097, plxDistPc: 305, plxVia: 'hip2_parallax' }),
      starAt(40_000, { hip: 23527, plxDistPc: 250, plxVia: 'hip2_parallax' }),
    ];
    const sample = new Map<string, SimbadDistanceEntry>([
      ['hip:25097', { simbadOid: 1, simbadMainId: 'HIP 25097', distancePc: 305 }],
    ]);
    const report = buildRegressionReport(stars, sample);
    expect(report.selfConsistency.map((o) => o.id)).toEqual(['hip:23527', 'hip:25097']);
    expect(report.simbad.map((o) => o.id)).toEqual(['hip:25097']);
  });
});

describe('compareRegressionReports + formatRegressionDiff', () => {
  const empty: RegressionReport = { selfConsistency: [], simbad: [] };

  it('reports all unchanged when reports match', () => {
    const r: RegressionReport = {
      selfConsistency: [hip2Outlier(1, 100, 1000, 1)],
      simbad: [],
    };
    const diff = compareRegressionReports(r, r);
    expect(diff.every((d) => d.status === 'unchanged')).toBe(true);
    expect(formatRegressionDiff(diff)).toMatch(/snapshot match/);
  });

  it('flags an added outlier', () => {
    const actual: RegressionReport = {
      selfConsistency: [hip2Outlier(1, 100, 1000, 1)],
      simbad: [],
    };
    const diff = compareRegressionReports(empty, actual);
    expect(diff.some((d) => d.status === 'added')).toBe(true);
    expect(formatRegressionDiff(diff)).toMatch(/\+selfConsistency hip:1/);
    expect(formatRegressionDiff(diff)).toMatch(/plx_via=hip2_parallax/);
  });

  it('flags a removed outlier', () => {
    const expected: RegressionReport = {
      selfConsistency: [hip2Outlier(1, 100, 1000, 1)],
      simbad: [],
    };
    const diff = compareRegressionReports(expected, empty);
    expect(diff.some((d) => d.status === 'removed')).toBe(true);
  });

  it('flags a changed outlier', () => {
    const expected: RegressionReport = {
      selfConsistency: [hip2Outlier(1, 100, 1000, 1)],
      simbad: [],
    };
    const actual: RegressionReport = {
      selfConsistency: [hip2Outlier(1, 100, 1200, 1.079)],
      simbad: [],
    };
    const diff = compareRegressionReports(expected, actual);
    expect(diff.some((d) => d.status === 'changed')).toBe(true);
  });

  it('ignores reason-only differences (hand-edited metadata never trips the gate)', () => {
    const expected: RegressionReport = {
      selfConsistency: [{ ...hip2Outlier(1, 100, 1000, 1), reason: 'old rationale' }],
      simbad: [],
    };
    const actual: RegressionReport = {
      // Same data, reason missing (as freshly detected).
      selfConsistency: [hip2Outlier(1, 100, 1000, 1)],
      simbad: [],
    };
    const diff = compareRegressionReports(expected, actual);
    expect(diff.every((d) => d.status === 'unchanged')).toBe(true);
  });
});

describe('mergeReasonsFromSnapshot', () => {
  it('carries hand-edited reasons over on matching ids', () => {
    const expected: RegressionReport = {
      selfConsistency: [{ ...hip2Outlier(1, 100, 1000, 1), reason: 'known calibrated outlier' }],
      simbad: [
        {
          id: 'gaia:42',
          finalDist: 6000,
          simbadDist: 1000,
          simbadMainId: '* rho Cas',
          logRatio: 0.778,
          reason: 'noisy Hipparcos parallax',
        },
      ],
    };
    const actual: RegressionReport = {
      // Slightly refreshed numbers, no reason.
      selfConsistency: [hip2Outlier(1, 100, 1010, 1.004)],
      simbad: [
        { id: 'gaia:42', finalDist: 6050, simbadDist: 1000, simbadMainId: '* rho Cas', logRatio: 0.782 },
      ],
    };
    const merged = mergeReasonsFromSnapshot(expected, actual);
    expect(merged.selfConsistency[0].reason).toBe('known calibrated outlier');
    expect(merged.selfConsistency[0].finalDist).toBe(1010);
    expect(merged.simbad[0].reason).toBe('noisy Hipparcos parallax');
    expect(merged.simbad[0].finalDist).toBe(6050);
  });

  it('leaves new outliers without a reason for the human to fill in', () => {
    const expected: RegressionReport = { selfConsistency: [], simbad: [] };
    const actual: RegressionReport = {
      selfConsistency: [hip2Outlier(999, 50, 500, 1)],
      simbad: [],
    };
    const merged = mergeReasonsFromSnapshot(expected, actual);
    expect(merged.selfConsistency[0].reason).toBeUndefined();
  });

  it('drops the reason when the outlier is no longer present', () => {
    // A star that used to be an outlier (with a reason) is no longer detected.
    // The fresh actual report omits it; mergeReasons must not resurrect it.
    const expected: RegressionReport = {
      selfConsistency: [{ ...hip2Outlier(1, 100, 1000, 1), reason: 'historical' }],
      simbad: [],
    };
    const actual: RegressionReport = { selfConsistency: [], simbad: [] };
    const merged = mergeReasonsFromSnapshot(expected, actual);
    expect(merged.selfConsistency).toEqual([]);
  });
});
