import { describe, expect, it } from 'vitest';
import {
  FADE_INNER_PC,
  FADE_OUTER_PC,
  smoothstep,
  solFrameFadeFactor,
} from './galactic-fade';

describe('galactic-fade', () => {
  it('fade band brackets the local-browsing-to-context-overlay transition', () => {
    expect(FADE_INNER_PC).toBe(500);
    expect(FADE_OUTER_PC).toBe(5000);
    expect(FADE_INNER_PC).toBeLessThan(FADE_OUTER_PC);
  });

  it('smoothstep clamps below the inner edge', () => {
    expect(smoothstep(0, 1, -0.5)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(FADE_INNER_PC, FADE_OUTER_PC, 0)).toBe(0);
  });

  it('smoothstep clamps above the outer edge', () => {
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(FADE_INNER_PC, FADE_OUTER_PC, 10_000)).toBe(1);
  });

  it('smoothstep midpoint is exactly 0.5 (Hermite t²(3−2t) symmetric)', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(FADE_INNER_PC, FADE_OUTER_PC, 2750)).toBeCloseTo(0.5, 10);
  });

  it('smoothstep has zero slope at both edges (Hermite property)', () => {
    const eps = 1e-6;
    // Right of edge0: f(eps) ≈ 3·eps² (low-order term is quadratic).
    expect(smoothstep(0, 1, eps)).toBeLessThan(eps);
    // Left of edge1: by symmetry, 1 - f(1-eps) is also O(eps²).
    expect(1 - smoothstep(0, 1, 1 - eps)).toBeLessThan(eps);
  });

  it('smoothstep is monotonic on the fade band', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 6000; d += 200) {
      const v = smoothstep(FADE_INNER_PC, FADE_OUTER_PC, d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('solFrameFadeFactor', () => {
  const win = { innerPc: 0.4, outerPc: 2 };

  it('is fully opaque out to the inner edge and gone at the outer', () => {
    expect(solFrameFadeFactor(0, win)).toBe(1);
    expect(solFrameFadeFactor(0.4, win)).toBe(1);
    expect(solFrameFadeFactor(2, win)).toBe(0);
    expect(solFrameFadeFactor(1.34, win)).toBeLessThan(0.5);
  });

  it('decreases monotonically across the window', () => {
    let prev = Infinity;
    for (let d = 0; d <= 2.5; d += 0.1) {
      const f = solFrameFadeFactor(d, win);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('steps rather than dividing by zero on a collapsed window', () => {
    const collapsed = { innerPc: 0.5, outerPc: 0.5 };
    expect(solFrameFadeFactor(0.49, collapsed)).toBe(1);
    expect(solFrameFadeFactor(0.5, collapsed)).toBe(0);
  });

  // Hiding is the only safe answer to a window that isn't a number: a NaN
  // opacity never reads as ≤ 0, so passing it through would draw a Sol-frame
  // layer at full strength from every distance.
  it('hides on a NaN window rather than passing NaN through as opacity', () => {
    expect(solFrameFadeFactor(0, { innerPc: 0.4, outerPc: NaN })).toBe(0);
    expect(solFrameFadeFactor(1e9, { innerPc: NaN, outerPc: NaN })).toBe(0);
  });

  it('is the inverse of the far-field reveal on the same band', () => {
    const band = { innerPc: FADE_INNER_PC, outerPc: FADE_OUTER_PC };
    for (const d of [0, 500, 2750, 5000, 10_000]) {
      expect(solFrameFadeFactor(d, band))
        .toBeCloseTo(1 - smoothstep(FADE_INNER_PC, FADE_OUTER_PC, d), 12);
    }
  });
});
