// Shard-contract pins: flat-index mapping, per-shard SID concatenation,
// chunk-local float64 reconstruction, the format-law quantisation claim,
// and the recentre eagerness rule (Catalog as shard 0).

import { describe, expect, it } from 'vitest';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import {
  CATALOG_BOUNDING_RADIUS_PC,
  catalogShard,
  DEFER_MAX_ERROR_PX,
  FLOAT32_EPS,
  shardRecentreEager,
  StarShardTable,
  type StarShard,
} from './star-shards-pure';

function makeShard(overrides: Partial<StarShard> = {}): StarShard {
  return {
    key: 'lmc',
    count: 2,
    positions: new Float32Array([0.5, 0, 0, -1, 2, 3]),
    chunkOrigin: [50_000, 0, 0],
    boundingRadiusPc: 5_000,
    sid: new Uint32Array([900, 901]),
    ...overrides,
  };
}

function twoShardTable() {
  const cat = makeEmptyCatalog(3);
  cat.sid.set([7, 8, 9]);
  return { cat, table: new StarShardTable([catalogShard(cat), makeShard()]) };
}

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

describe('StarShardTable mapping', () => {
  it('concatenates flat indices in shard order — shard 0 locals ARE flat', () => {
    const { table } = twoShardTable();
    expect(table.flatCount).toBe(5);
    expect(table.flatIndexOf(0, 2)).toBe(2);
    expect(table.flatIndexOf(1, 0)).toBe(3);
    expect(table.flatIndexOf(1, 1)).toBe(4);
    expect(table.flatIndexOf(0, 3)).toBe(-1);
    expect(table.flatIndexOf(1, 2)).toBe(-1);
    expect(table.flatIndexOf(2, 0)).toBe(-1);
    expect(table.flatIndexOf(0, -1)).toBe(-1);
  });

  it('round-trips flat → (shard, local) across the boundary', () => {
    const { table } = twoShardTable();
    expect(table.shardLocalOf(2)).toEqual({ shard: 0, local: 2 });
    expect(table.shardLocalOf(3)).toEqual({ shard: 1, local: 0 });
    expect(table.shardLocalOf(4)).toEqual({ shard: 1, local: 1 });
    expect(table.shardLocalOf(5)).toBeNull();
    expect(table.shardLocalOf(-1)).toBeNull();
    for (let flat = 0; flat < table.flatCount; flat++) {
      const at = table.shardLocalOf(flat)!;
      expect(table.flatIndexOf(at.shard, at.local)).toBe(flat);
    }
  });
});

describe('StarShardTable SID domain', () => {
  it('single shard answers the catalog column itself — no 313k copy', () => {
    const cat = makeEmptyCatalog(3);
    const table = new StarShardTable([catalogShard(cat)]);
    expect(table.sids()).toBe(cat.sid);
  });

  it('multi-shard concatenates the per-shard columns in flat order', () => {
    const { table } = twoShardTable();
    expect(Array.from(table.sids())).toEqual([7, 8, 9, 900, 901]);
    expect(table.sids()).toBe(table.sids());
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

  it('reconstructs absolute positions as float64 origin + local', () => {
    const { table } = twoShardTable();
    const out = { x: 0, y: 0, z: 0 };
    expect(table.absolutePositionInto(3, out)).toBe(true);
    expect(out.x).toBe(50_000 + 0.5);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
    expect(table.absolutePositionInto(4, out)).toBe(true);
    expect(out.x).toBe(50_000 + Math.fround(-1));
    expect(out.z).toBe(3);
    expect(table.absolutePositionInto(5, out)).toBe(false);
  });

  it('keeps a non-float32-representable chunk origin exact', () => {
    const origin = 49_999.777000001;
    expect(Math.fround(origin)).not.toBe(origin);
    const table = new StarShardTable([
      makeShard({ chunkOrigin: [origin, 0, 0] }),
    ]);
    const out = { x: 0, y: 0, z: 0 };
    expect(table.absolutePositionInto(0, out)).toBe(true);
    expect(out.x).toBe(origin + 0.5);
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

  it('holds the sub-pixel clearance just outside the bounding sphere', () => {
    // d − R = 1 pc, inside the FLOAT32_EPS·d·angularToPx/0.5 ≈ 2.4 pc
    // clearance the DEFER_MAX_ERROR_PX bound solves to at d ≈ 5 kpc.
    const dJustOutside = lmc.boundingRadiusPc + 1;
    const clearance =
      (FLOAT32_EPS * dJustOutside * ANGULAR_TO_PX) / DEFER_MAX_ERROR_PX;
    expect(clearance).toBeGreaterThan(1);
    expect(
      shardRecentreEager(lmc, 50_000 + dJustOutside, 0, 0, ANGULAR_TO_PX),
    ).toBe(true);
  });

  it('shard 0 rewrites eagerly from every in-catalog origin', () => {
    const cat = catalogShard(makeEmptyCatalog(1));
    expect(shardRecentreEager(cat, 0, 0, 0, ANGULAR_TO_PX)).toBe(true);
    expect(shardRecentreEager(cat, 30_000, 0, 0, ANGULAR_TO_PX)).toBe(true);
    expect(shardRecentreEager(cat, 0, 0, 59_999, ANGULAR_TO_PX)).toBe(true);
  });
});
