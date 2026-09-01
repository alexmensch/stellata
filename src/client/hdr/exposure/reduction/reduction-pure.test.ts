import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exposureForMagLimit } from '../exposure-epoch';
import {
  combineReductionTexels,
  createTileScratch,
  reduceTileLevel,
  type ReductionTexel,
  reductionChainSizes,
  reductionLevelSizes,
  REDUCTION_TILE_TEXELS,
  rescaleToBaseExposure,
  statisticTexelToReduction,
  weightedMedian,
} from './reduction-pure';

const shader = readFileSync(
  fileURLToPath(new URL('./reduce.frag.glsl', import.meta.url)),
  'utf8',
).replace(/\/\/[^\n]*/g, '');

/** Run a whole frame of level-0 texels through the chain the shader draws,
 *  down to whichever sizes are asked for. */
function reduceLevels(
  width: number,
  height: number,
  sizes: readonly (readonly [number, number])[],
  flux: (x: number, y: number) => number,
  mask: (x: number, y: number) => number,
) {
  let level: ReductionTexel[][] = [];
  for (let y = 0; y < height; y++) {
    level.push([]);
    for (let x = 0; x < width; x++) {
      level[y].push(statisticTexelToReduction(flux(x, y), mask(x, y)));
    }
  }
  for (const [w, h] of sizes) {
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
  return level;
}

/** The old 1x1 tail: what the chain returned before it stopped at a tile
 *  grid, and the standard the CPU combine has to reproduce exactly. */
function reduceFrame(
  width: number,
  height: number,
  flux: (x: number, y: number) => number,
  mask: (x: number, y: number) => number = () => 0,
) {
  return reduceLevels(width, height, reductionLevelSizes(width, height), flux, mask)[0][0];
}

/** The chain as it now runs: down to the tile level, read back whole, and
 *  combined on the CPU. */
function reduceToTiles(
  width: number,
  height: number,
  flux: (x: number, y: number) => number,
  mask: (x: number, y: number) => number = () => 0,
) {
  const sizes = reductionChainSizes(width, height);
  const tiles = reduceLevels(width, height, sizes, flux, mask);
  const [tw, th] = sizes[sizes.length - 1];
  const pixels = new Float32Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const t = tiles[y][x];
      pixels.set([t.mean, t.surface, t.coverage, t.weight], 4 * (y * tw + x));
    }
  }
  return reduceTileLevel(pixels, tw * th, createTileScratch(tw * th));
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

describe('the masked mean and the coverage', () => {
  /** A 16x16 lit surface of true brightness 40 in the corner of a 64x64
   *  frame, over a faint star field the mask never claims. */
  const litSquare = (x: number, y: number) => (x < 16 && y < 16 ? 1 : 0);

  it('divides out to the lit surface own mean, whatever it covers', () => {
    // The property the exposure pin rests on: D is the masked mean over the
    // masked area, so it is the surface's brightness and nothing else's.
    for (const side of [4, 16, 48, 64]) {
      const inside = (x: number, y: number) => (x < side && y < side ? 1 : 0);
      const reduced = reduceFrame(64, 64, (x, y) => 40 * inside(x, y) + 0.01, inside);
      expect(reduced.coverage).toBeCloseTo((side * side) / 4096, 12);
      expect(reduced.surface / reduced.coverage).toBeCloseTo(40.01, 9);
    }
  });

  it('leaves the pin untouched by light outside the mask', () => {
    const dim = reduceFrame(64, 64, (x, y) => 40 * litSquare(x, y), litSquare);
    const glared = reduceFrame(
      64, 64, (x, y) => 40 * litSquare(x, y) + 900 * (1 - litSquare(x, y)), litSquare);
    expect(glared.mean).toBeGreaterThan(20 * dim.mean);
    expect(glared.surface / glared.coverage).toBeCloseTo(dim.surface / dim.coverage, 9);
  });

  it('reads zero coverage on a frame with no lit surface in it', () => {
    const reduced = reduceFrame(13, 7, (x, y) => (x === 9 && y === 2 ? 500 : 1));
    expect(reduced.coverage).toBe(0);
    expect(reduced.surface).toBe(0);
  });

  it('survives a level whose taps are all out of bounds but one', () => {
    expect(combineReductionTexels([{ mean: 7, surface: 3, coverage: 0.5, weight: 0.25 }]))
      .toEqual({ mean: 7, surface: 3, coverage: 0.5, weight: 0.0625 });
  });
});

describe('combineReductionTexels', () => {
  it('reads an all-empty output texel as zero rather than NaN', () => {
    expect(combineReductionTexels([]))
      .toEqual({ mean: 0, surface: 0, coverage: 0, weight: 0 });
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
    const combined = combineReductionTexels([
      { mean: 0, surface: 0, coverage: 0, weight: 1 },
    ]);
    expect(shader).toContain('weight * 0.25');
    expect(combined.weight).toBe(0.25);
  });

  it('drops out-of-bounds taps from the weight, not just the numerator', () => {
    expect(shader).toMatch(/if \(c\.x >= bound\.x \|\| c\.y >= bound\.y\) continue;/);
    expect(shader).toContain('weight += t.a');
    expect(shader).toContain('numerator += t.a * s');
  });

  it('reads an all-empty output texel as zero rather than NaN, like the spec', () => {
    expect(shader).toContain('weight > 0.0 ? numerator / weight : vec3(0.0)');
    expect(combineReductionTexels([]).mean).toBe(0);
  });

  it('forms the masked-mean numerator only on the pass reading the attachment', () => {
    // Level 0 is the RG16F statistic, which carries the flux and the mask
    // but no product of the two; every level after it already has one, and
    // multiplying again there would square the mask.
    expect(shader).toContain('uFromStatistic > 0.5 ? vec3(t.r, t.r * t.g, t.g) : t.rgb');
    const level0 = statisticTexelToReduction(9, 1);
    expect(level0).toEqual({ mean: 9, surface: 9, coverage: 1, weight: 1 });
    expect(statisticTexelToReduction(9, 0).surface).toBe(0);
  });
});

describe('the tile level the chain stops at', () => {
  const last = (w: number, h: number) => {
    const sizes = reductionChainSizes(w, h);
    return sizes[sizes.length - 1];
  };

  it('picks the level nearest the tile budget in log ratio', () => {
    expect(REDUCTION_TILE_TEXELS).toBe(1024);
    // 1600x900 quarters through 22 600 and 5700 to 1450, then 375. The
    // sequence quarters, so 1450 (ratio 1.42) beats 375 (ratio 2.73).
    expect(last(1600, 900)).toEqual([50, 29]);
    expect(reductionChainSizes(1600, 900)).toHaveLength(5);
    // A 2x device-pixel ratio adds one level and lands on the same grid,
    // which is what keeps the estimator's resolution off the DPR.
    expect(last(3200, 1800)).toEqual([50, 29]);
    expect(reductionChainSizes(3200, 1800)).toHaveLength(6);
    expect(last(3840, 2160)).toEqual([60, 34]);
    expect(last(800, 600)).toEqual([50, 38]);
  });

  it('is a prefix of the full halving chain, so no level changes size', () => {
    for (const [w, h] of [[1600, 900], [3840, 2160], [800, 600], [13, 7]] as const) {
      const chain = reductionChainSizes(w, h);
      expect(chain).toEqual(reductionLevelSizes(w, h).slice(0, chain.length));
    }
  });

  it('has no level at all on a 1x1 drawing buffer', () => {
    expect(reductionChainSizes(1, 1)).toEqual([]);
  });
});

describe('the CPU combine over the tile level', () => {
  const litSquare = (x: number, y: number) => (x < 16 && y < 16 ? 1 : 0);

  it('reproduces the frame mean and coverage the 1x1 tail used to return', () => {
    // The whole reason the tail can go: a texel's weight times its level's
    // 4^k is the count of level-0 texels behind it, so weighting by the
    // weight alone across one level IS the frame mean. Exactly, not nearly.
    const flux = (x: number, y: number) => 1 + x * y;
    for (const [w, h] of [[64, 64], [77, 45], [13, 7]] as const) {
      const tail = reduceFrame(w, h, flux, litSquare);
      const tiles = reduceToTiles(w, h, flux, litSquare);
      expect(tiles.meanL).toBeCloseTo(tail.mean, 9);
      expect(tiles.coverage).toBeCloseTo(tail.coverage, 12);
    }
  });

  it('reads a frame with no lit surface as zero coverage and zero subject', () => {
    const tiles = reduceToTiles(64, 64, (x, y) => (x === 9 && y === 2 ? 500 : 1));
    expect(tiles.coverage).toBe(0);
    expect(tiles.discL).toBe(0);
    expect(tiles.meanL).toBeGreaterThan(0);
  });

  it('segments a blinding minority emitter out of the subject', () => {
    // The measured case the pooled mean could not survive: a photosphere at
    // 1.82e10 sharing the frame with a parked body at 8.6e4. Pooling them at
    // ANY exponent lands 9 to 23 magnitudes off; the median does not see the
    // star at all, because it owns 1 % of the masked area.
    const body = (x: number, y: number) => (x < 40 && y < 40 ? 1 : 0);
    const star = (x: number, y: number) => (x >= 60 && y >= 60 ? 1 : 0);
    const flux = (x: number, y: number) => 8.6e4 * body(x, y) + 1.82e10 * star(x, y);
    const lit = (x: number, y: number) => Math.max(body(x, y), star(x, y));
    const tiles = reduceToTiles(64, 64, flux, lit);
    expect(tiles.discL).toBeCloseTo(8.6e4, 6);
    // The area-weighted mean the pin used to read is 8.30 magnitudes out.
    const pooled = reduceFrame(64, 64, flux, lit);
    const pooledD = pooled.surface / pooled.coverage;
    expect(2.5 * Math.log10(pooledD / tiles.discL)).toBeCloseTo(8.30, 2);
  });
});

describe('the coverage-weighted median', () => {
  const median = (pairs: readonly (readonly [number, number])[]) => {
    const scratch = createTileScratch(pairs.length);
    pairs.forEach(([v, w], i) => {
      scratch.values[i] = v;
      scratch.weights[i] = w;
    });
    return weightedMedian(scratch, pairs.length);
  };

  it('is the value the cumulative weight reaches half the total at', () => {
    expect(median([])).toBe(0);
    expect(median([[7, 3]])).toBe(7);
    expect(median([[1, 1], [2, 1], [3, 1]])).toBe(2);
    // Weight, not count: two light samples cannot outvote one heavy one.
    expect(median([[1, 1], [2, 1], [3, 9]])).toBe(3);
  });

  it('does not care what order the tiles arrive in', () => {
    const pairs: [number, number][] = [[9, 2], [1, 5], [4, 1], [7, 3], [2, 4]];
    const answer = median(pairs);
    expect(answer).toBe(2);
    expect(median([...pairs].reverse())).toBe(answer);
    expect(median([pairs[2], pairs[4], pairs[0], pairs[3], pairs[1]])).toBe(answer);
  });

  it('holds against a majority of equal values', () => {
    // The degenerate case a three-way partition exists for: every tile of a
    // uniform surface carries the same number, and a two-way split would
    // recurse forever on it.
    expect(median(Array.from({ length: 999 }, () => [5, 1] as const))).toBe(5);
  });

  it('is monotone in every sample, which is what keeps LUMA_CEIL safe', () => {
    // The clamp lowers each tile's flux and can never raise one, so the
    // median it produces is a lower bound on the truth exactly as the mean
    // was — the loop still converges from above (README.md § Measure at the
    // base exposure).
    const pairs: [number, number][] = [[3, 1], [900, 2], [4096, 5], [12000, 3]];
    const clamped = pairs.map(([v, w]) => [Math.min(v, 4096), w] as const);
    expect(median(clamped)).toBeLessThanOrEqual(median(pairs));
  });

  it('scales with a positive factor, so the base-exposure rescale commutes', () => {
    const pairs: [number, number][] = [[3, 1], [900, 2], [12000, 3]];
    const k = 1 / 37;
    expect(median(pairs.map(([v, w]) => [v * k, w] as const)))
      .toBeCloseTo(median(pairs) * k, 12);
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
