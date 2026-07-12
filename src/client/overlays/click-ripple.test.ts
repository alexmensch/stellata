import { describe, expect, it } from 'vitest';
import {
  rippleFrameAt,
  RIPPLE_COLLAPSE_MS,
  RIPPLE_EXPAND_MS,
  RIPPLE_MAX_RADIUS_PX,
} from './click-ripple';

describe('rippleFrameAt', () => {
  it('starts at radius 0 and full opacity', () => {
    const f = rippleFrameAt(0)!;
    expect(f.radius).toBe(0);
    expect(f.opacity).toBeGreaterThan(0.5);
  });

  it('expands monotonically to the POI-ring radius', () => {
    let prev = -1;
    for (let t = 0; t <= RIPPLE_EXPAND_MS; t += RIPPLE_EXPAND_MS / 8) {
      const f = rippleFrameAt(t)!;
      expect(f.radius).toBeGreaterThanOrEqual(prev);
      prev = f.radius;
    }
    expect(rippleFrameAt(RIPPLE_EXPAND_MS)!.radius).toBeCloseTo(RIPPLE_MAX_RADIUS_PX, 5);
  });

  it('collapses back toward 0 while fading', () => {
    const mid = rippleFrameAt(RIPPLE_EXPAND_MS + RIPPLE_COLLAPSE_MS / 2)!;
    expect(mid.radius).toBeLessThan(RIPPLE_MAX_RADIUS_PX);
    expect(mid.radius).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(rippleFrameAt(RIPPLE_EXPAND_MS)!.opacity);
  });

  it('finishes (null) once expand + collapse have elapsed', () => {
    expect(rippleFrameAt(RIPPLE_EXPAND_MS + RIPPLE_COLLAPSE_MS)).toBeNull();
    expect(rippleFrameAt(10_000)).toBeNull();
  });

  it('clamps negative elapsed to the start state', () => {
    expect(rippleFrameAt(-5)!.radius).toBe(0);
  });
});
