import { describe, expect, it } from 'vitest';

import {
  BASE_STEP_MICRODAYS,
  MICRODAYS_PER_DAY,
  MIN_STEP_MICRODAYS,
  chordMissAu,
  decimateByChordError,
  hermiteBulgeAu,
  jdOfMicrodays,
  microdaysOf,
  planEpochRequests,
  type VectorRow,
} from './adaptive-grid-pure';

/** A row on a circle of radius `r` AU in the xy plane, angle `theta`,
 *  travelling at `speed` AU/day — a stand-in for the curving inner-system
 *  cruise where the chord error is a plain sagitta. */
function circleRow(jd: number, r: number, theta: number, speed: number): VectorRow {
  return [
    jd,
    r * Math.cos(theta),
    r * Math.sin(theta),
    0,
    -speed * Math.sin(theta),
    speed * Math.cos(theta),
    0,
  ];
}

describe('microday epochs', () => {
  it('round-trips every bisection of the base step', () => {
    let mu = BASE_STEP_MICRODAYS;
    while (mu > 1) {
      expect(Number.isInteger(mu)).toBe(true);
      expect(microdaysOf(jdOfMicrodays(mu))).toBe(mu);
      mu /= 2;
    }
  });

  it('reaches the sub-two-minute floor Voyager 2 at Neptune needs', () => {
    expect(jdOfMicrodays(MIN_STEP_MICRODAYS) * 86400).toBeCloseTo(88.47, 2);
    expect(jdOfMicrodays(BASE_STEP_MICRODAYS)).toBeCloseTo(33.554432, 6);
  });

  it('survives a JD string rounded to the six decimals Horizons takes', () => {
    const mu = microdaysOf(2443938.5) + MIN_STEP_MICRODAYS;
    expect(microdaysOf(Number(jdOfMicrodays(mu).toFixed(6)))).toBe(mu);
  });
});

describe('chordMissAu', () => {
  it('is the sagitta of a circular arc', () => {
    const half = 0.2;
    const a = circleRow(0, 1, -half, 0.017);
    const m = circleRow(1, 1, 0, 0.017);
    const b = circleRow(2, 1, half, 0.017);
    expect(chordMissAu(a, m, b)).toBeCloseTo(1 - Math.cos(half), 12);
  });

  it('is zero on a straight uniformly sampled run', () => {
    const at = (jd: number): VectorRow => [jd, jd * 2, jd * -3, jd * 0.5, 2, -3, 0.5];
    expect(chordMissAu(at(0), at(7), at(10))).toBeCloseTo(0, 12);
  });

  it('weights by the midpoint epoch, not by index', () => {
    const at = (jd: number): VectorRow => [jd, jd * jd, 0, 0, 2 * jd, 0, 0];
    // x = t² sampled at 0, 1, 4: the chord at t=1 is 4, the curve is 1.
    expect(chordMissAu(at(0), at(1), at(4))).toBeCloseTo(3, 12);
  });
});

describe('hermiteBulgeAu', () => {
  it('sees an arc the midpoint probe would also see', () => {
    const half = 0.2;
    const speed = 0.017;
    // One day of travel spans 2·half radians, so ω = 2·half rad/day.
    const days = (2 * half) / speed;
    const a = circleRow(0, 1, -half, speed);
    const b = circleRow(days, 1, half, speed);
    expect(hermiteBulgeAu(a, b)).toBeGreaterThan(0.5 * (1 - Math.cos(half)));
  });

  it('catches an S-bend whose midpoint sits back on the chord', () => {
    // Endpoints and midpoint collinear in t, but the velocities point off
    // the chord — the case a midpoint probe alone reports as converged.
    const a: VectorRow = [0, 0, 0, 0, 1, 1, 0];
    const b: VectorRow = [1, 1, 0, 0, 1, -1, 0];
    expect(chordMissAu(a, [0.5, 0.5, 0, 0, 1, 0, 0], b)).toBeCloseTo(0, 12);
    expect(hermiteBulgeAu(a, b)).toBeGreaterThan(0.1);
  });

  it('is zero on a straight constant-velocity run', () => {
    const a: VectorRow = [0, 0, 0, 0, 2, -3, 0.5];
    const b: VectorRow = [10, 20, -30, 5, 2, -3, 0.5];
    expect(hermiteBulgeAu(a, b)).toBeCloseTo(0, 12);
  });
});

describe('decimateByChordError', () => {
  const straight = Array.from({ length: 50 }, (_, i): VectorRow => [i, i, 2 * i, -i, 1, 2, -1]);

  it('collapses a straight run to its endpoints', () => {
    expect(decimateByChordError(straight, 1e-9)).toHaveLength(2);
  });

  it('keeps every sample whose removal would breach the tolerance', () => {
    const arc = Array.from({ length: 101 }, (_, i) =>
      circleRow(i, 1, (i / 100) * 0.5, 0.017),
    );
    const kept = decimateByChordError(arc, 1e-4);
    expect(kept.length).toBeGreaterThan(2);
    expect(kept.length).toBeLessThan(arc.length);
    for (let i = 0; i < arc.length; i++) {
      const j = kept.findIndex((row) => row[0] >= arc[i][0]);
      if (j <= 0) continue;
      expect(chordMissAu(kept[j - 1], arc[i], kept[j])).toBeLessThanOrEqual(1e-4);
    }
  });

  it('never drops an endpoint, whatever the tolerance', () => {
    const kept = decimateByChordError(straight, 1e9);
    expect(kept).toEqual([straight[0], straight[straight.length - 1]]);
  });

  it('passes runs too short to have an interior sample through', () => {
    expect(decimateByChordError([straight[0], straight[1]], 1e-9)).toHaveLength(2);
    expect(decimateByChordError([], 1e-9)).toHaveLength(0);
  });
});

describe('planEpochRequests', () => {
  it('turns an evenly spaced round into a single range query', () => {
    const mus = Array.from({ length: 500 }, (_, i) => 1000 + i * 64);
    expect(planEpochRequests(mus, 2000, 70)).toEqual([
      { kind: 'range', startMu: 1000, stopMu: 1000 + 499 * 64, intervals: 499 },
    ]);
  });

  it('splits a run longer than the per-request row cap', () => {
    const mus = Array.from({ length: 250 }, (_, i) => i * 10);
    const plan = planEpochRequests(mus, 100, 70);
    expect(plan).toHaveLength(3);
    expect(plan.flatMap(epochsOf)).toEqual(mus);
  });

  it('batches scattered epochs into lists inside the TLIST cap', () => {
    const mus = Array.from({ length: 150 }, (_, i) => i * i * 1000);
    const plan = planEpochRequests(mus, 2000, 70);
    expect(plan.every((r) => r.kind === 'list' && r.mus.length <= 70)).toBe(true);
    expect(plan.flatMap(epochsOf).sort((a, b) => a - b)).toEqual(mus);
  });

  it('covers every requested epoch exactly once across a mixed round', () => {
    const mus = [
      ...Array.from({ length: 40 }, (_, i) => 1_000_000 + i * 2048),
      9_000_000,
      ...Array.from({ length: 12 }, (_, i) => 20_000_000 + i * 512),
      99_000_000,
    ];
    const covered = planEpochRequests(mus, 2000, 70).flatMap(epochsOf);
    expect(covered.sort((a, b) => a - b)).toEqual(mus);
  });

  it('has nothing to ask for when the round is empty', () => {
    expect(planEpochRequests([], 2000, 70)).toEqual([]);
  });
});

function epochsOf(request: ReturnType<typeof planEpochRequests>[number]): number[] {
  if (request.kind === 'list') return request.mus;
  const step = (request.stopMu - request.startMu) / request.intervals;
  return Array.from({ length: request.intervals + 1 }, (_, i) =>
    Math.round(request.startMu + i * step),
  );
}

describe('grid constants', () => {
  it('bisects the base step onto the floor in whole halvings', () => {
    expect(BASE_STEP_MICRODAYS / MIN_STEP_MICRODAYS).toBe(2 ** 15);
    expect(MICRODAYS_PER_DAY).toBe(1e6);
  });
});
