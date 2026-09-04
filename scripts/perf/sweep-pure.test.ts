import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP_SCALES,
  FILL_BOUND_SLOPE,
  VERTEX_BOUND_SLOPE,
  classifyBound,
  fitLogLog,
  sweepBracketMs,
  sweepOrder,
  type SweepPoint,
} from './sweep-pure';

function point(scale: number, px: number, ms: number, vsyncClamped = false): SweepPoint {
  return { scale, width: Math.round(1280 * scale), height: Math.round(800 * scale), px, ms, vsyncClamped };
}

/** ms exactly proportional to px: the fill-bound ideal. */
const PROPORTIONAL = [
  point(0.5, 1e6, 10),
  point(1, 4e6, 40),
  point(1.5, 9e6, 90),
  point(2, 16e6, 160),
];

/** Frame time independent of area: vertex or CPU bound. */
const CONSTANT = [
  point(0.5, 1e6, 33),
  point(1, 4e6, 33),
  point(2, 16e6, 33),
];

describe('sweepOrder', () => {
  it('brackets the sweep with scale 1 at both ends', () => {
    expect(sweepOrder([...DEFAULT_SWEEP_SCALES])).toEqual([1, 0.5, 1.5, 2, 1]);
  });

  it('sorts the interior ascending whatever order was asked for', () => {
    expect(sweepOrder([2, 0.5, 1.5])).toEqual([1, 0.5, 1.5, 2, 1]);
  });

  it('measures scale 1 twice even when it is the only scale asked for', () => {
    expect(sweepOrder([1])).toEqual([1, 1]);
  });

  it('collapses a repeated scale rather than measuring it twice mid-sweep', () => {
    expect(sweepOrder([0.5, 0.5, 2])).toEqual([1, 0.5, 2, 1]);
  });
});

describe('fitLogLog', () => {
  it('pins slope 1 for a frame proportional to pixel count', () => {
    const fit = fitLogLog(PROPORTIONAL);
    expect(fit.slope).toBeCloseTo(1, 9);
    expect(fit.r2).toBeCloseTo(1, 9);
    expect(fit.bound).toBe('fill');
    expect(fit.points).toBe(4);
  });

  it('pins slope 0 for a frame that does not track area', () => {
    const fit = fitLogLog(CONSTANT);
    expect(fit.slope).toBeCloseTo(0, 9);
    expect(fit.bound).toBe('vertex/cpu');
  });

  it('pins a square-law frame at slope 2', () => {
    const quadratic = PROPORTIONAL.map((p) => ({ ...p, ms: (p.px / 1e6) ** 2 }));
    expect(fitLogLog(quadratic).slope).toBeCloseTo(2, 9);
  });

  it('lands between the thresholds on a half-fill frame', () => {
    const half = PROPORTIONAL.map((p) => ({ ...p, ms: Math.sqrt(p.px / 1e6) }));
    const fit = fitLogLog(half);
    expect(fit.slope).toBeCloseTo(0.5, 9);
    expect(fit.slope).toBeGreaterThan(VERTEX_BOUND_SLOPE);
    expect(fit.slope).toBeLessThan(FILL_BOUND_SLOPE);
    expect(fit.bound).toBe('mixed');
  });

  it('is inconclusive when any point was vsync-clamped, however clean the line', () => {
    const clamped = [...PROPORTIONAL.slice(0, 3), point(2, 16e6, 160, true)];
    const fit = fitLogLog(clamped);
    expect(fit.slope).toBeCloseTo(1, 9);
    expect(fit.bound).toBe('inconclusive');
  });

  it('is inconclusive rather than throwing when there is nothing to fit', () => {
    expect(fitLogLog([]).bound).toBe('inconclusive');
    expect(fitLogLog([point(1, 4e6, 40)]).bound).toBe('inconclusive');
  });

  it('is inconclusive when every point sits at one area', () => {
    const oneArea = [point(1, 4e6, 40), point(1, 4e6, 44)];
    expect(fitLogLog(oneArea).bound).toBe('inconclusive');
  });

  it('drops a non-positive sample instead of taking log of it', () => {
    const withZero = [...PROPORTIONAL, point(3, 36e6, 0)];
    expect(fitLogLog(withZero).points).toBe(4);
    expect(fitLogLog(withZero).slope).toBeCloseTo(1, 9);
  });
});

describe('classifyBound', () => {
  it('puts the thresholds themselves on the decisive side', () => {
    expect(classifyBound(FILL_BOUND_SLOPE, [])).toBe('fill');
    expect(classifyBound(VERTEX_BOUND_SLOPE, [])).toBe('vertex/cpu');
  });
});

describe('sweepBracketMs', () => {
  it('is the spread of the two scale-1 medians', () => {
    const drifted = [point(1, 4e6, 40), point(0.5, 1e6, 10), point(1, 4e6, 37)];
    expect(sweepBracketMs(drifted)).toBe(3);
  });

  it('is zero when scale 1 was not measured twice', () => {
    expect(sweepBracketMs([point(0.5, 1e6, 10), point(2, 16e6, 160)])).toBe(0);
  });
});
