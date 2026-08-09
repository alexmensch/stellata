// Shard-format pins: the catalog as shard 0, the float32 quantisation the
// chunk-local format exists to avoid, and the recentre eagerness rule
// including the clearance crossing it solves for.

import { describe, expect, it } from 'vitest';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import { makeShard } from './star-shard-mock';
import {
  CATALOG_BOUNDING_RADIUS_PC,
  catalogShard,
  FLOAT32_EPS,
  shardRecentreEager,
} from './star-shards-pure';

describe('catalogShard', () => {
  it('is shard 0 verbatim: zero origin, catalog columns by reference', () => {
    const cat = makeEmptyCatalog(3);
    const s = catalogShard(cat);
    expect(s.key).toBe('catalog');
    expect(s.chunkOrigin).toEqual([0, 0, 0]);
    expect(s.positions).toBe(cat.positions);
    expect(s.sid).toBe(cat.sid);
    expect(s.boundingRadiusPc).toBe(CATALOG_BOUNDING_RADIUS_PC);
    expect(CATALOG_BOUNDING_RADIUS_PC).toBe(60_000);
  });
});

describe('chunk-local coordinate format', () => {
  it('float32 ABSOLUTE coordinates quantise to 32 pc at 306 Mpc — the format law', () => {
    const farPc = 3.06e8;
    const ulpPc = 2 ** Math.floor(Math.log2(farPc)) * FLOAT32_EPS;
    expect(ulpPc).toBe(32);
    expect(Math.fround(farPc + 8)).toBe(Math.fround(farPc));
    // The same 8 pc offset survives exactly as a chunk-local value.
    expect(Math.fround(8)).toBe(8);
  });
});

describe('shardRecentreEager', () => {
  const ANGULAR_TO_PX = 2000;
  const lmc = makeShard();

  it('defers a far shard: recentring at Sol leaves the LMC field alone', () => {
    expect(shardRecentreEager(lmc, 0, 0, 0, ANGULAR_TO_PX)).toBe(false);
  });

  it('rewrites eagerly with the origin inside the shard', () => {
    expect(shardRecentreEager(lmc, 48_000, 0, 0, ANGULAR_TO_PX)).toBe(true);
  });

  // The rule solves FLOAT32_EPS·d·angularToPx/(d − R) = DEFER_MAX_ERROR_PX,
  // crossing at d = R/(1 − FLOAT32_EPS·angularToPx/DEFER_MAX_ERROR_PX) =
  // 5002.385 pc for these inputs. Both sides are pinned: dropping the
  // DEFER_MAX_ERROR_PX division (or using the half-ulp 2**-24) moves the
  // crossing to 5001.19 and fails the eager side.
  it('rewrites eagerly just inside the solved clearance', () => {
    expect(shardRecentreEager(lmc, 50_000 + 5002, 0, 0, ANGULAR_TO_PX)).toBe(true);
  });

  it('defers just outside the solved clearance', () => {
    expect(shardRecentreEager(lmc, 50_000 + 5003, 0, 0, ANGULAR_TO_PX)).toBe(false);
  });

  it('scales the clearance with angularToPx — a wider plate scale rewrites sooner', () => {
    expect(shardRecentreEager(lmc, 50_000 + 5003, 0, 0, ANGULAR_TO_PX * 4)).toBe(true);
  });

  it('shard 0 rewrites eagerly from every in-catalog origin', () => {
    const cat = catalogShard(makeEmptyCatalog(1));
    expect(shardRecentreEager(cat, 0, 0, 0, ANGULAR_TO_PX)).toBe(true);
    expect(shardRecentreEager(cat, 30_000, 0, 0, ANGULAR_TO_PX)).toBe(true);
    expect(shardRecentreEager(cat, 0, 0, 59_999, ANGULAR_TO_PX)).toBe(true);
  });
});
