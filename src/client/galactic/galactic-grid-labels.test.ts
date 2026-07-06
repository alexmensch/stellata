import { describe, it, expect } from 'vitest';
import { edgeLabelPlacement, separateLabels, type Rect, type EdgeLabel } from './galactic-grid-labels';

const W = 800;
const H = 600;
const PAD = 10;
const HW = 10; // label half-width
const HH = 6; // label half-height

function place(xs: number[], ys: number[], exclude: Rect[] = []) {
  return edgeLabelPlacement(xs, ys, xs.length, W, H, HW, HH, PAD, exclude);
}

describe('edgeLabelPlacement', () => {
  it('returns null when the line never leaves the viewport', () => {
    expect(place([100, 200, 300], [100, 200, 300])).toBeNull();
  });

  it('drops a vertical meridian to its bottom-edge crossing, tilted vertical', () => {
    const p = place([100, 100, 100], [-50, 300, 700])!;
    expect(p.x).toBeCloseTo(100);
    // Bottom crossing at y=H, pulled in so the whole rotated box clears the
    // edge by PAD: vertical text → hy = HW = 10, so y = H - PAD - hy.
    expect(p.y).toBeCloseTo(H - PAD - HW);
    expect(Math.abs(p.rotDeg)).toBeCloseTo(90);
  });

  it('prefers the bottom crossing over the top crossing (drops downhill)', () => {
    const p = place([100, 100, 100], [-50, 300, 700])!;
    expect(p.y).toBeGreaterThan(H / 2);
  });

  it('skips a crossing whose box overlaps chrome, falling back to the top', () => {
    const chrome: Rect = { left: 0, top: H - 120, right: 260, bottom: H };
    const p = place([100, 100, 100], [-50, 300, 700], [chrome])!;
    expect(p.y).toBeCloseTo(PAD + HW);
  });

  it('ignores behind-camera (NaN) samples', () => {
    const p = place([NaN, 100, 100], [NaN, 300, 700])!;
    expect(p.y).toBeCloseTo(H - PAD - HW);
  });

  it('keeps the whole box inside the viewport (no edge overhang)', () => {
    const p = place([100, 100, 100], [-50, 300, 700])!;
    expect(p.y + p.hy).toBeLessThanOrEqual(H - PAD + 1e-6);
    expect(p.x - p.hx).toBeGreaterThanOrEqual(PAD - 1e-6);
  });

  it('places a horizontal line at a side edge', () => {
    const p = place([400, 600, 900], [200, 200, 200])!;
    expect(p.x).toBeCloseTo(W - PAD - HW);
    expect(p.y).toBeCloseTo(200);
    expect(p.rotDeg).toBeCloseTo(0);
  });
});

describe('separateLabels', () => {
  const mk = (x: number, y: number): EdgeLabel => ({ x, y, rotDeg: 0, hx: 20, hy: 10 });

  it('pushes overlapping labels apart until they no longer overlap', () => {
    const a = mk(100, 100);
    const b = mk(110, 100);
    separateLabels([a, b], [], W, H, PAD);
    const overlapping = Math.abs(a.x - b.x) < a.hx + b.hx && Math.abs(a.y - b.y) < a.hy + b.hy;
    expect(overlapping).toBe(false);
  });

  it('is deterministic — identical inputs give identical output', () => {
    const run = () => {
      const ls = [mk(100, 100), mk(108, 102), mk(96, 98)];
      separateLabels(ls, [], W, H, PAD);
      return ls.map((l) => [Math.round(l.x * 100), Math.round(l.y * 100)]);
    };
    expect(run()).toEqual(run());
  });

  it('shoves a label out of an immovable chrome rect', () => {
    const chrome: Rect = { left: 90, top: 90, right: 200, bottom: 200 };
    const a = mk(120, 120);
    separateLabels([a], [chrome], W, H, PAD);
    const inChrome =
      a.x + a.hx > chrome.left &&
      a.x - a.hx < chrome.right &&
      a.y + a.hy > chrome.top &&
      a.y - a.hy < chrome.bottom;
    expect(inChrome).toBe(false);
  });
});
