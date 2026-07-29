import { describe, expect, it } from 'vitest';
import type {
  BoundaryFadeTableWire,
  BoundarySegmentWire,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { solFrameFadeFactor } from '../galactic/galactic-fade';
import {
  FADE_END_MISPLACED_PCT,
  FADE_START_MISPLACED_PCT,
  boundarySegmentVertices,
  resolveBoundaryFadeWindowPc,
} from './boundary-layer-pure';

const RADIUS = 100;

function segment(directions: number[]): BoundarySegmentWire {
  return { k: 'P', c: ['DEL', 'AQL'], d: directions };
}

/** Two magnitude rows, quantile columns in the artifact's own order. */
const FADE: BoundaryFadeTableWire = {
  magLimits: [6, 8],
  quantilePcts: [0.1, 1, 5, 50],
  offsetsPc: [
    [0.14, 0.4, 0.9, 7],
    [0.31, 0.6, 1.5, 10],
  ],
  sampleCounts: [3000, 20000],
};

describe('boundarySegmentVertices', () => {
  it('expands an n-sample polyline into n−1 scaled endpoint pairs', () => {
    const out = boundarySegmentVertices(
      [segment([1, 0, 0, 0, 1, 0, 0, 0, 1])],
      RADIUS,
    );
    expect(out.length).toBe(12);
    expect(Array.from(out)).toEqual([
      100, 0, 0, 0, 100, 0,
      0, 100, 0, 0, 0, 100,
    ]);
  });

  it('never joins consecutive arcs — each record contributes its own segments', () => {
    const out = boundarySegmentVertices(
      [segment([1, 0, 0, 0, 1, 0]), segment([0, 0, 1, 0, 0, -1])],
      1,
    );
    // 2 arcs × 1 segment × 2 endpoints × 3 components; the last vertex of arc
    // one and the first of arc two never pair.
    expect(out.length).toBe(12);
    expect(Array.from(out.slice(6))).toEqual([0, 0, 1, 0, 0, -1]);
  });

  it('drops a degenerate single-sample arc rather than emitting a stub', () => {
    expect(boundarySegmentVertices([segment([1, 0, 0])], RADIUS).length).toBe(0);
  });
});

describe('resolveBoundaryFadeWindowPc', () => {
  it('reads the 1% and 5% columns on an exact magnitude row', () => {
    expect(FADE.quantilePcts[1]).toBe(FADE_START_MISPLACED_PCT);
    expect(FADE.quantilePcts[2]).toBe(FADE_END_MISPLACED_PCT);
    expect(resolveBoundaryFadeWindowPc(FADE, 6)).toEqual({ innerPc: 0.4, outerPc: 0.9 });
    expect(resolveBoundaryFadeWindowPc(FADE, 8)).toEqual({ innerPc: 0.6, outerPc: 1.5 });
  });

  it('lerps both edges between rows', () => {
    const mid = resolveBoundaryFadeWindowPc(FADE, 7);
    expect(mid.innerPc).toBeCloseTo(0.5, 12);
    expect(mid.outerPc).toBeCloseTo(1.2, 12);
  });

  it('clamps past either end — the slider reaches limits the table cannot describe', () => {
    expect(resolveBoundaryFadeWindowPc(FADE, 0)).toEqual(resolveBoundaryFadeWindowPc(FADE, 6));
    expect(resolveBoundaryFadeWindowPc(FADE, 15)).toEqual(resolveBoundaryFadeWindowPc(FADE, 8));
  });

  it('widens as the limit faints — dimmer stars sit nearer their walls', () => {
    const bright = resolveBoundaryFadeWindowPc(FADE, 6);
    const faint = resolveBoundaryFadeWindowPc(FADE, 8);
    expect(faint.innerPc).toBeGreaterThan(bright.innerPc);
    expect(faint.outerPc).toBeGreaterThan(bright.outerPc);
  });

  it('throws when the artifact dropped a quantile the runtime reads', () => {
    const without = { ...FADE, quantilePcts: [0.1, 50], offsetsPc: [[0.14, 7], [0.31, 10]] };
    expect(() => resolveBoundaryFadeWindowPc(without, 6)).toThrow(/no 1% quantile/);
  });
});

describe('the resolved window against solFrameFadeFactor', () => {
  it('has completed well before α Cen at the naked-eye limit', () => {
    const alphaCenPc = 1.34;
    expect(solFrameFadeFactor(alphaCenPc, resolveBoundaryFadeWindowPc(FADE, 6.5))).toBe(0);
  });

  it('widens with a fainter limit rather than narrowing', () => {
    const bright = resolveBoundaryFadeWindowPc(FADE, 6);
    const faint = resolveBoundaryFadeWindowPc(FADE, 8);
    const d = bright.outerPc;
    expect(solFrameFadeFactor(d, bright)).toBe(0);
    expect(solFrameFadeFactor(d, faint)).toBeGreaterThan(0);
  });
});
