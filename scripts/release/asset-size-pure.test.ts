import { describe, it, expect } from 'vitest';

import {
  ASSET_WARN_FRACTION,
  MiB,
  WORKERS_MAX_ASSET_BYTES,
  formatMiB,
  judgeAssetSizes,
} from './asset-size-pure';
import {
  CATALOG_CHUNK_TARGET_BYTES,
  CATALOG_FIRST_CHUNK_TARGET_BYTES,
  planCatalogChunks,
} from '../../src/catalog-format/record/catalog-pure';

describe('judgeAssetSizes', () => {
  it('pins the Workers ceiling at 25 MiB', () => {
    expect(WORKERS_MAX_ASSET_BYTES).toBe(26_214_400);
  });

  it('flags the file that broke the deploy', () => {
    const verdict = judgeAssetSizes([
      { path: 'index.html', bytes: 4096 },
      { path: 'catalog-row-index-map.json', bytes: Math.round(28.4 * MiB) },
    ]);
    expect(verdict.oversize.map((a) => a.path)).toEqual(['catalog-row-index-map.json']);
    expect(verdict.nearLimit).toEqual([]);
  });

  it('allows exactly the limit and rejects one byte over', () => {
    const verdict = judgeAssetSizes([
      { path: 'at', bytes: WORKERS_MAX_ASSET_BYTES },
      { path: 'over', bytes: WORKERS_MAX_ASSET_BYTES + 1 },
    ]);
    expect(verdict.oversize.map((a) => a.path)).toEqual(['over']);
    expect(verdict.nearLimit.map((a) => a.path)).toEqual(['at']);
  });

  it('warns only above the warn fraction', () => {
    const threshold = Math.floor(WORKERS_MAX_ASSET_BYTES * ASSET_WARN_FRACTION);
    const verdict = judgeAssetSizes([
      { path: 'below', bytes: threshold },
      { path: 'above', bytes: threshold + 1 },
    ]);
    expect(verdict.nearLimit.map((a) => a.path)).toEqual(['above']);
    expect(verdict.oversize).toEqual([]);
  });

  it('orders every list largest first', () => {
    const verdict = judgeAssetSizes([
      { path: 'small', bytes: MiB },
      { path: 'a', bytes: 26 * MiB },
      { path: 'near-a', bytes: 21 * MiB },
      { path: 'b', bytes: 30 * MiB },
      { path: 'near-b', bytes: 24 * MiB },
    ]);
    expect(verdict.largestFirst.map((a) => a.path)).toEqual(['b', 'a', 'near-b', 'near-a', 'small']);
    expect(verdict.oversize.map((a) => a.path)).toEqual(['b', 'a']);
    expect(verdict.nearLimit.map((a) => a.path)).toEqual(['near-b', 'near-a']);
  });
});

describe('formatMiB', () => {
  it('prints one decimal place', () => {
    expect(formatMiB(Math.round(28.4 * MiB))).toBe('28.4 MiB');
  });
});

describe('the catalogue transport plan against the Workers budget', () => {
  it('the chunk target sits under the Workers per-asset ceiling', () => {
    expect(CATALOG_CHUNK_TARGET_BYTES).toBeLessThan(WORKERS_MAX_ASSET_BYTES);
  });

  it('no chunk ever exceeds the target, at any catalogue size', () => {
    // A plan that doubled past the target would break deploy rather than
    // fail a test, so the doubling is asserted clamped rather than trusted.
    for (const totalMiB of [37, 94, 235, 4096]) {
      const plan = planCatalogChunks(totalMiB * MiB);
      expect(Math.max(...plan), `${totalMiB} MiB`).toBe(CATALOG_CHUNK_TARGET_BYTES);
      expect(plan.reduce((a, b) => a + b, 0)).toBe(totalMiB * MiB);
    }
  });

  it('the first chunk is the first-paint payload, not the transport ceiling', () => {
    expect(CATALOG_FIRST_CHUNK_TARGET_BYTES).toBeLessThan(CATALOG_CHUNK_TARGET_BYTES);
    expect(planCatalogChunks(100 * MiB)[0]).toBe(CATALOG_FIRST_CHUNK_TARGET_BYTES);
  });
});
