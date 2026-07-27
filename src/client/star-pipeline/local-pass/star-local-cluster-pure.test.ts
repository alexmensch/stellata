import { describe, expect, it } from 'vitest';
import {
  discWindowPc,
  isResolvedDiscStar,
  PHYS_RATIO_THRESHOLD,
  RESOLVED_DISC_MIN_PX,
} from './star-local-cluster-pure';

describe('isResolvedDiscStar', () => {
  it('accepts a physSize-dominated disc at the minimum size', () => {
    expect(isResolvedDiscStar(2, RESOLVED_DISC_MIN_PX)).toBe(true);
  });

  it('accepts a disc-pass star whose quad is appSize-driven', () => {
    // ratio = 6/10 ≥ 0.5 → disc pass; quad 10 px ≥ min.
    expect(isResolvedDiscStar(10, 6)).toBe(true);
  });

  it('rejects a glow-pass star regardless of quad size', () => {
    // ratio = 4/10 < 0.5 → glow pass writes no depth.
    expect(isResolvedDiscStar(10, 4)).toBe(false);
  });

  it('rejects a sub-threshold disc', () => {
    expect(isResolvedDiscStar(1, RESOLVED_DISC_MIN_PX - 1)).toBe(false);
  });

  it('pivots exactly at the pass split and the pixel floor', () => {
    expect(isResolvedDiscStar(10, 10 * PHYS_RATIO_THRESHOLD)).toBe(true);
    expect(
      isResolvedDiscStar(RESOLVED_DISC_MIN_PX, RESOLVED_DISC_MIN_PX),
    ).toBe(true);
    expect(isResolvedDiscStar(0, RESOLVED_DISC_MIN_PX * 0.99)).toBe(false);
  });

  it('honours an explicit minPx override', () => {
    expect(isResolvedDiscStar(0, 3, 2.5)).toBe(true);
    expect(isResolvedDiscStar(0, 2, 2.5)).toBe(false);
  });
});

describe('discWindowPc', () => {
  const FOV = Math.PI / 4;
  const VIEWPORT_H = 1080;

  it('returns the distance where the largest star subtends px pixels', () => {
    const maxR = 1e-5;
    const d = discWindowPc(maxR, RESOLVED_DISC_MIN_PX, FOV, VIEWPORT_H);
    // Invert: angular diameter at d equals px pixels.
    const px = (2 * Math.atan(maxR / d) * VIEWPORT_H) / FOV;
    expect(px).toBeCloseTo(RESOLVED_DISC_MIN_PX, 6);
  });

  it('widens as the pixel threshold shrinks', () => {
    const maxR = 1e-5;
    const scan = discWindowPc(maxR, RESOLVED_DISC_MIN_PX * PHYS_RATIO_THRESHOLD, FOV, VIEWPORT_H);
    const mask = discWindowPc(maxR, RESOLVED_DISC_MIN_PX, FOV, VIEWPORT_H);
    expect(scan).toBeGreaterThan(mask);
    expect(scan / mask).toBeCloseTo(2, 5);
  });

  it('stays finite for a degenerate viewport', () => {
    expect(Number.isFinite(discWindowPc(1e-5, 5, FOV, 0))).toBe(true);
  });
});
