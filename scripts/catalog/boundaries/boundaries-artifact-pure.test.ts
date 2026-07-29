import { describe, expect, it } from 'vitest';

import { parseIauEdges } from '../../../src/client/constellation-boundaries/iau-boundaries-pure';
import {
  DIRECTION_DECIMALS,
  FADE_MIN_SAMPLES,
  FADE_OFFSET_DECIMALS,
  MISPLACEMENT_TOLERANCE_DEG,
  buildBoundaryArtifact,
  buildFadeTable,
  countDirections,
  misplacementOffsetPc,
  toSegmentWire,
  type FadeSample,
} from './boundaries-artifact-pure';

const EDGE_RECORDS = [
  '1:2 M+ 00:00:00 +10:00:00 00:00:00 +20:00:00 AAA BBB',
  '3:4 P+ 02:00:00 +30:00:00 04:00:00 +30:00:00 CCC DDD',
];

function samples(count: number, offsetPc: (i: number) => number, appMag = 0): FadeSample[] {
  return Array.from({ length: count }, (_, i) => ({ offsetPc: offsetPc(i), appMag }));
}

describe('boundary segment wire shape', () => {
  const edges = parseIauEdges(EDGE_RECORDS);

  it('flattens directions into x,y,z triples and keeps the source con pair', () => {
    const wire = toSegmentWire({
      kind: 'M', conA: 'AAA', conB: 'BBB',
      directions: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
    });
    expect(wire).toEqual({ k: 'M', c: ['AAA', 'BBB'], d: [1, 0, 0, 0, 1, 0] });
  });

  it('quantises each component to the declared decimals', () => {
    const wire = toSegmentWire({
      kind: 'P', conA: 'CCC', conB: 'DDD',
      directions: [{ x: 0.123456789, y: -0.987654321, z: 1 / 3 }],
    });
    for (const v of wire.d) {
      expect(v).toBe(Number(v.toFixed(DIRECTION_DECIMALS)));
    }
    expect(wire.d[0]).toBe(0.1234568);
  });

  it('counts one direction per triple across every segment', () => {
    const artifact = buildBoundaryArtifact(edges, samples(FADE_MIN_SAMPLES, (i) => i + 1));
    expect(artifact.segments).toHaveLength(2);
    expect(countDirections(artifact.segments))
      .toBe(artifact.segments.reduce((n, s) => n + s.d.length / 3, 0));
    // The equinox the arcs are drawn at and the frame they are emitted in are
    // different things, and confusing them is the whole failure mode here.
    expect(artifact.epoch).toBe('B1875');
    expect(artifact.frame).toBe('ICRS');
  });
});

describe('misplacement offset', () => {
  it('scales the tolerance-widened angle by the star distance', () => {
    // A star sitting exactly on a wall still tolerates the tolerance itself.
    expect(misplacementOffsetPc(0, 100))
      .toBeCloseTo(MISPLACEMENT_TOLERANCE_DEG * (Math.PI / 180) * 100, 12);
    // Doubling the distance doubles the offset the same angle buys.
    expect(misplacementOffsetPc(2, 200)).toBeCloseTo(2 * misplacementOffsetPc(2, 100), 12);
  });
});

describe('fade table', () => {
  it('reads each percentile off the offset distribution of its own subset', () => {
    // 200 stars at 1…200 pc; the brighter half is the near half. Each row's
    // percentiles must come from its own subset, so widening the magnitude
    // limit pushes every one of them outward.
    const mixed: FadeSample[] = Array.from({ length: 200 }, (_, i) => ({
      offsetPc: i + 1,
      appMag: i < 100 ? 5 : 9,
    }));
    const table = buildFadeTable(mixed, [5, 9], [1, 50, 100]);
    expect(table.magLimits).toEqual([5, 9]);
    expect(table.sampleCounts).toEqual([100, 200]);
    expect(table.offsetsPc[0]).toEqual([1, 50, 100]);
    expect(table.offsetsPc[1]).toEqual([2, 100, 200]);
  });

  it('drops a magnitude row too thin to carry a percentile', () => {
    const thin: FadeSample[] = [
      ...samples(FADE_MIN_SAMPLES - 1, (i) => i + 1, 3),
      ...samples(FADE_MIN_SAMPLES, (i) => i + 1, 8),
    ];
    const table = buildFadeTable(thin, [3, 8, 9], [50]);
    expect(table.magLimits).toEqual([8, 9]);
    expect(table.sampleCounts).toEqual([FADE_MIN_SAMPLES * 2 - 1, FADE_MIN_SAMPLES * 2 - 1]);
  });

  it('refuses a table the runtime could not interpolate across', () => {
    // One surviving row gives the runtime a single constant, not a window it
    // can lerp from the live magnitude slider — fail loudly at build time
    // rather than ship a fade that ignores the slider.
    expect(() => buildFadeTable(samples(FADE_MIN_SAMPLES, (i) => i + 1, 5), [0, 5], [50]))
      .toThrow(/at least two magnitude rows/);
  });

  it('rounds every offset to the declared decimals', () => {
    // Unrounded, these are the only full-precision floats in the artifact and
    // its byte length becomes a function of their last bit — which differs
    // between Node versions, so the size pin drifts for no real reason.
    const table = buildFadeTable(
      samples(FADE_MIN_SAMPLES * 2, (i) => (i + 1) * Math.PI / 7, 4), [4, 5], [1, 50],
    );
    for (const row of table.offsetsPc) {
      for (const v of row) expect(v).toBe(Number(v.toFixed(FADE_OFFSET_DECIMALS)));
    }
    // 128 samples, so the 1% rank is the 2nd and the 50% the 64th.
    expect(table.offsetsPc[0]).toEqual([
      Number((2 * Math.PI / 7).toFixed(FADE_OFFSET_DECIMALS)),
      Number((64 * Math.PI / 7).toFixed(FADE_OFFSET_DECIMALS)),
    ]);
  });

  it('is monotonic in the percentile rank within a row', () => {
    const table = buildFadeTable(
      samples(1000, (i) => (i + 1) * 0.01, 4), [4, 5], [0.1, 1, 5, 50],
    );
    for (const row of table.offsetsPc) {
      for (let j = 1; j < row.length; j++) expect(row[j]).toBeGreaterThanOrEqual(row[j - 1]);
    }
  });
});
