import { describe, it, expect } from 'vitest';
import { placeGridLabel } from './galactic-grid-labels';

const OFF = 9;

describe('placeGridLabel', () => {
  it('returns null for a degenerate (zero-length) tangent', () => {
    expect(placeGridLabel(100, 100, 100, 100, OFF, true)).toBeNull();
  });

  it('offsets above a horizontal line with no rotation', () => {
    const p = placeGridLabel(100, 100, 110, 100, OFF, true)!;
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(100 - OFF);
    expect(p.rotDeg).toBeCloseTo(0);
  });

  it('keeps text upright on a right-to-left line (folds 180° rotation)', () => {
    const p = placeGridLabel(100, 100, 90, 100, OFF, true)!;
    // Still above the line, and rotation folded from 180° back to 0°.
    expect(p.y).toBeCloseTo(100 - OFF);
    expect(p.rotDeg).toBeCloseTo(0);
  });

  it('chooses the top side by tangent direction when clear of vertical', () => {
    // Up-right tangent → ux>0 branch; label offsets up-left.
    const up = placeGridLabel(100, 100, 110, 90, OFF, false)!;
    expect(up.uxPos).toBe(true);
    expect(up.y).toBeLessThan(100);
  });

  it('holds the previous side near vertical (hysteresis)', () => {
    // Tangent within 5° of vertical (ux≈0.05 < sin5°≈0.087): the side is
    // held, not flipped, even though ux ≥ 0.
    const held = placeGridLabel(100, 100, 100.5, 110, OFF, false);
    expect(held!.uxPos).toBe(false);
    // A tangent clearly off vertical does flip.
    const flipped = placeGridLabel(100, 100, 105, 110, OFF, false);
    expect(flipped!.uxPos).toBe(true);
  });
});
