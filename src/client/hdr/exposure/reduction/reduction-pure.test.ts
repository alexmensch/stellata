import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exposureForMagLimit } from '../exposure-epoch';
import {
  combineReductionTexels,
  type ReductionTexel,
  reductionLevelSizes,
  rescaleToBaseExposure,
} from './reduction-pure';

const shader = readFileSync(
  fileURLToPath(new URL('./reduce.frag.glsl', import.meta.url)),
  'utf8',
).replace(/\/\/[^\n]*/g, '');

/** Run a whole frame of level-0 texels through the chain the shader draws,
 *  so the 1x1 result can be compared against the true mean directly. */
function reduceFrame(width: number, height: number, flux: (x: number, y: number) => number) {
  let level: ReductionTexel[][] = [];
  for (let y = 0; y < height; y++) {
    level.push([]);
    for (let x = 0; x < width; x++) {
      level[y].push({ mean: flux(x, y), peak: flux(x, y), weight: 1 });
    }
  }
  for (const [w, h] of reductionLevelSizes(width, height)) {
    const next: ReductionTexel[][] = [];
    for (let y = 0; y < h; y++) {
      next.push([]);
      for (let x = 0; x < w; x++) {
        const taps: ReductionTexel[] = [];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const row = level[2 * y + dy];
            const tap = row?.[2 * x + dx];
            if (tap !== undefined) taps.push(tap);
          }
        }
        next[y].push(combineReductionTexels(taps));
      }
    }
    level = next;
  }
  return level[0][0];
}

describe('reductionLevelSizes', () => {
  it('halves with ceil down to a single texel', () => {
    expect(reductionLevelSizes(8, 8)).toEqual([[4, 4], [2, 2], [1, 1]]);
    expect(reductionLevelSizes(1, 1)).toEqual([]);
  });

  it('keeps a ragged axis alive until the other one lands', () => {
    // 5 -> 3 -> 2 -> 1, and the short axis holds at 1 rather than
    // collapsing the chain early.
    expect(reductionLevelSizes(5, 1)).toEqual([[3, 1], [2, 1], [1, 1]]);
  });

  it('costs one level per doubling of the larger axis', () => {
    expect(reductionLevelSizes(3840, 2160)).toHaveLength(12);
  });
});

describe('the reduced mean', () => {
  it('is the exact frame mean on a power-of-two frame', () => {
    const flux = (x: number, y: number) => x + 2 * y;
    const reduced = reduceFrame(8, 4, flux);
    let total = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) total += flux(x, y);
    expect(reduced.mean).toBeCloseTo(total / 32, 12);
  });

  it('stays exact on a frame no axis of which is a power of two', () => {
    // The whole reason texels carry a weight: an unweighted chain would
    // over-count the ragged last row and column of every odd level.
    const flux = (x: number, y: number) => 1 + x * y;
    const reduced = reduceFrame(13, 7, flux);
    let total = 0;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 13; x++) total += flux(x, y);
    expect(reduced.mean).toBeCloseTo(total / (13 * 7), 12);
  });

  it('carries one bright texel at its true share of the frame', () => {
    const reduced = reduceFrame(64, 64, (x, y) => (x === 3 && y === 61 ? 4096 : 0));
    expect(reduced.mean).toBeCloseTo(4096 / 4096, 12);
  });
});

describe('the reduced peak', () => {
  it('is the frame max, not a mean of any kind', () => {
    const reduced = reduceFrame(13, 7, (x, y) => (x === 9 && y === 2 ? 500 : 1));
    expect(reduced.peak).toBe(500);
  });

  it('survives a level whose taps are all out of bounds but one', () => {
    expect(combineReductionTexels([{ mean: 7, peak: 500, weight: 0.25 }]))
      .toEqual({ mean: 7, peak: 500, weight: 0.0625 });
  });
});

describe('combineReductionTexels', () => {
  it('reads an all-empty output texel as zero rather than NaN', () => {
    expect(combineReductionTexels([])).toEqual({ mean: 0, peak: 0, weight: 0 });
  });
});

// combineReductionTexels is the spec; reduce.frag.glsl is what runs. The
// two are tied by nothing at compile time, and a window widened on one side
// alone silently biases the frame mean rather than failing.
describe('GLSL drift', () => {
  it('walks the same 2x2 window the spec combines', () => {
    expect(shader).toContain('dy < 2');
    expect(shader).toContain('dx < 2');
  });

  it('divides the outgoing weight by the same window area', () => {
    const combined = combineReductionTexels([{ mean: 0, peak: 0, weight: 1 }]);
    expect(shader).toContain('weight * 0.25');
    expect(combined.weight).toBe(0.25);
  });

  it('drops out-of-bounds taps from the weight, not just the numerator', () => {
    expect(shader).toMatch(/if \(c\.x >= bound\.x \|\| c\.y >= bound\.y\) continue;/);
    expect(shader).toContain('weight += t.a');
    expect(shader).toContain('numerator += t.a * t.r');
  });

  it('reads an all-empty output texel as zero rather than NaN, like the spec', () => {
    expect(shader).toContain('weight > 0.0 ? numerator / weight : 0.0');
    expect(combineReductionTexels([]).mean).toBe(0);
  });

  it('maxes the peak channel instead of averaging it', () => {
    expect(shader).toContain('peak = max(peak, t.g)');
  });
});

describe('rescaleToBaseExposure', () => {
  it('is the identity when the frame was drawn at the base exposure', () => {
    const base = exposureForMagLimit(7.8);
    expect(rescaleToBaseExposure(3.2, base, base)).toBeCloseTo(3.2, 12);
  });

  it('undoes the cut the frame was drawn with, so the loop cannot feed itself', () => {
    const base = exposureForMagLimit(7.8);
    const cut = base * 10 ** (0.4 * -8);
    // A scene that measured L at the base exposure writes L·(cut/base)
    // into the attachment once the cut is applied; the rescale has to
    // return the same L, or the next frame would cut again.
    expect(rescaleToBaseExposure(5 * (cut / base), cut, base)).toBeCloseTo(5, 12);
  });

  it('reads a degenerate render exposure as no measurement', () => {
    expect(rescaleToBaseExposure(5, 0, 26.365)).toBe(0);
  });
});
