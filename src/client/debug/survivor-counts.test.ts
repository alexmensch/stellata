import { describe, expect, it } from 'vitest';
import { formatSurvivorReport, survivorReport } from './survivor-counts';

describe('survivorReport', () => {
  it('states each tier against the catalogue, and both together', () => {
    const r = survivorReport({ glow: 40_000, disc: 7 }, 388_071);
    expect(r.records).toBe(388_071);
    expect(r.glowFraction).toBeCloseTo(40_000 / 388_071, 12);
    expect(r.discFraction).toBeCloseTo(7 / 388_071, 12);
    expect(r.drawnFraction).toBeCloseTo(40_007 / 388_071, 12);
  });

  // The vantages this number exists for include ones where nothing draws;
  // an empty catalogue is the same arithmetic without the NaN.
  it('reads zero rather than NaN with no records', () => {
    expect(survivorReport({ glow: 0, disc: 0 }, 0).drawnFraction).toBe(0);
  });

  it('prints the ratio beside the count', () => {
    expect(formatSurvivorReport(survivorReport({ glow: 1, disc: 1 }, 200)))
      .toContain('survivors: 2 of 200 records (1.00%)');
  });
});
