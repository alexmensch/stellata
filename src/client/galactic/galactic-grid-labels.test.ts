import { describe, it, expect } from 'vitest';
import { edgeLabelPlacement, type Rect } from './galactic-grid-labels';

const W = 800;
const H = 600;
const PAD = 10;

// Helper: run placement over an (xs, ys) polyline.
function place(xs: number[], ys: number[], exclude: Rect[] = []) {
  return edgeLabelPlacement(xs, ys, xs.length, W, H, PAD, exclude);
}

describe('edgeLabelPlacement', () => {
  it('returns null when the line never leaves the viewport', () => {
    expect(place([100, 200, 300], [100, 200, 300])).toBeNull();
  });

  it('drops a vertical meridian to its bottom-edge crossing, tilted vertical', () => {
    // Vertical line at x=100 spanning above the top edge to below the bottom.
    const p = place([100, 100, 100], [-50, 300, 700])!;
    expect(p.x).toBeCloseTo(100);
    // Bottom crossing at y=H, inset up by PAD.
    expect(p.y).toBeCloseTo(H - PAD);
    expect(Math.abs(p.rotDeg)).toBeCloseTo(90);
  });

  it('prefers the bottom crossing over the top crossing (drops downhill)', () => {
    const p = place([100, 100, 100], [-50, 300, 700])!;
    // Not the top crossing (which would sit near y=PAD).
    expect(p.y).toBeGreaterThan(H / 2);
  });

  it('skips a crossing that lands inside excluded chrome, falling back', () => {
    // Bottom crossing at x≈100 sits under a bottom-left chrome rect → the
    // only other exit is the top edge, so the label falls back up there.
    const chrome: Rect = { left: 0, top: H - 120, right: 260, bottom: H };
    const p = place([100, 100, 100], [-50, 300, 700], [chrome])!;
    expect(p.y).toBeCloseTo(PAD);
  });

  it('ignores behind-camera (NaN) samples', () => {
    // First segment invalid; the valid tail still crosses the bottom edge.
    const p = place([NaN, 100, 100], [NaN, 300, 700])!;
    expect(p.y).toBeCloseTo(H - PAD);
  });

  it('places a horizontal line at a side edge', () => {
    // Horizontal line at y=200 running off the right edge.
    const p = place([400, 600, 900], [200, 200, 200])!;
    expect(p.x).toBeCloseTo(W - PAD);
    expect(p.y).toBeCloseTo(200);
    expect(p.rotDeg).toBeCloseTo(0);
  });
});
