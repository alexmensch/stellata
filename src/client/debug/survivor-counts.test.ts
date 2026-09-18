import { describe, expect, it } from 'vitest';
import { formatSurvivorReport, survivorReport } from './survivor-counts';

describe('survivorReport', () => {
  it('states each tier against the catalogue, and both together', () => {
    const r = survivorReport({ glow: 40_000, disc: 7, prefilter: 116_000 }, 388_071);
    expect(r.records).toBe(388_071);
    expect(r.glowFraction).toBeCloseTo(40_000 / 388_071, 12);
    expect(r.discFraction).toBeCloseTo(7 / 388_071, 12);
    expect(r.drawnFraction).toBeCloseTo(40_007 / 388_071, 12);
  });

  // The frustum's own prize is drawn over prefilter-passing, not over the
  // catalogue: the kernel it would gate already skips the prefilter's rejects.
  it('states the drawn share of the prefilter-passing population', () => {
    const r = survivorReport({ glow: 20_000, disc: 595, prefilter: 116_000 }, 388_071);
    expect(r.prefilterFraction).toBeCloseTo(116_000 / 388_071, 12);
    expect(r.drawnOfPrefilter).toBeCloseTo(20_595 / 116_000, 12);
  });

  // The vantages this number exists for include ones where nothing draws;
  // an empty catalogue is the same arithmetic without the NaN.
  it('reads zero rather than NaN with no records or no prefilter survivors', () => {
    const r = survivorReport({ glow: 0, disc: 0, prefilter: 0 }, 0);
    expect(r.drawnFraction).toBe(0);
    expect(r.drawnOfPrefilter).toBe(0);
  });

  it('prints the ratio beside the count', () => {
    const text = formatSurvivorReport(survivorReport({ glow: 1, disc: 1, prefilter: 8 }, 200));
    expect(text).toContain('survivors: 2 of 200 records (1.00%)');
    expect(text).toContain('passing the prefilter 8 (4.00%); drawn of those 25.00%');
  });
});
