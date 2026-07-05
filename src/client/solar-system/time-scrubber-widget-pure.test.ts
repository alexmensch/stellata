import { describe, it, expect } from 'vitest';
import { formatRatePerSecond } from './time-scrubber-widget-pure';
import { MAX_RATE } from './time';

describe('formatRatePerSecond', () => {
  it('reports paused at rate 0', () => {
    expect(formatRatePerSecond(0)).toBe('paused');
  });

  it('glues the seconds unit and keeps realtime literal', () => {
    expect(formatRatePerSecond(1)).toBe('1s / second');
    expect(formatRatePerSecond(2)).toBe('2s / second');
  });

  it('steps up to the largest unit the rate reaches', () => {
    expect(formatRatePerSecond(60)).toBe('1 min / second');
    expect(formatRatePerSecond(3600)).toBe('1 hr / second');
    expect(formatRatePerSecond(86400)).toBe('1 day / second');
    expect(formatRatePerSecond(604800)).toBe('1 week / second');
    expect(formatRatePerSecond(31557600)).toBe('1 yr / second');
  });

  it('pluralises word units past 1', () => {
    expect(formatRatePerSecond(2 * 86400)).toBe('2 days / second');
    expect(formatRatePerSecond(3 * 604800)).toBe('3 weeks / second');
  });

  it('keeps one decimal below 10, integer at or above', () => {
    expect(formatRatePerSecond(128)).toBe('2.1 min / second');
    expect(formatRatePerSecond(10 * 3600)).toBe('10 hr / second');
  });

  it('carries a minus sign for rewind rates', () => {
    expect(formatRatePerSecond(-2)).toBe('−2s / second');
    expect(formatRatePerSecond(-86400)).toBe('−1 day / second');
  });

  it('tops out in decades at the max rate (never centuries)', () => {
    // 2^30 sim-seconds/sec ≈ 34 yr/s ≈ 3.4 decades/s.
    expect(formatRatePerSecond(MAX_RATE)).toBe('3.4 decades / second');
  });
});
