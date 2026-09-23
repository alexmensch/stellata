import { describe, it, expect } from 'vitest';

import {
  ASSET_WARN_FRACTION,
  WORKERS_MAX_ASSET_BYTES,
  formatMiB,
  judgeAssetSizes,
} from './asset-size-pure';

const MiB = 1024 * 1024;

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

  it('orders each list largest first', () => {
    const verdict = judgeAssetSizes([
      { path: 'a', bytes: 26 * MiB },
      { path: 'b', bytes: 30 * MiB },
    ]);
    expect(verdict.oversize.map((a) => a.path)).toEqual(['b', 'a']);
  });
});

describe('formatMiB', () => {
  it('prints one decimal place', () => {
    expect(formatMiB(Math.round(28.4 * MiB))).toBe('28.4 MiB');
  });
});
