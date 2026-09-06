// Flat Target.idx mapping pins: shard-order concatenation, the SID domain,
// float64 position reconstruction, and the column-length contract.

import { describe, expect, it } from 'vitest';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import { makeShard } from './star-shard-mock';
import { StarShardTable } from './star-shard-table';
import { catalogShard } from './star-shards-pure';

function twoShardTable() {
  const cat = makeEmptyCatalog(3);
  cat.sid.set([7, 8, 9]);
  return { cat, table: new StarShardTable([catalogShard(cat), makeShard()]) };
}

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

  it('skips an empty shard rather than resolving flat indices onto it', () => {
    const empty = makeShard({
      key: 'empty', count: 0, positions: new Float32Array(0), sid: new Uint32Array(0),
    });
    const table = new StarShardTable([makeShard(), empty, makeShard({ key: 'smc' })]);
    expect(table.flatCount).toBe(4);
    expect(table.shardLocalOf(2)).toEqual({ shard: 2, local: 0 });
    expect(table.flatIndexOf(1, 0)).toBe(-1);
  });

  it('rejects a shard whose columns disagree with its count', () => {
    expect(() => new StarShardTable([makeShard({ count: 3 })]))
      .toThrow(/star shard 'lmc'/);
    expect(() => new StarShardTable([makeShard({ sid: new Uint32Array(5) })]))
      .toThrow(/sid 5/);
  });

  it('is unaffected by later mutation of the caller\'s shard array', () => {
    const shards = [makeShard()];
    const table = new StarShardTable(shards);
    shards.push(makeShard({ key: 'smc' }));
    expect(table.flatCount).toBe(2);
    expect(table.shards).toHaveLength(1);
  });
});

describe('StarShardTable SID domain', () => {
  it('single shard answers the catalog column itself — no 380k copy', () => {
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

describe('StarShardTable absolute positions', () => {
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
    const table = new StarShardTable([makeShard({ chunkOrigin: [origin, 0, 0] })]);
    const out = { x: 0, y: 0, z: 0 };
    expect(table.absolutePositionInto(0, out)).toBe(true);
    expect(out.x).toBe(origin + 0.5);
  });
});
