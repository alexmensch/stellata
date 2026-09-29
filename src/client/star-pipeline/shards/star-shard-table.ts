// Flat Target.idx space over an ordered star-shard list. See ./README.md#flat-targetidx-space.

import type { StarShard } from './star-shards-pure';

export class StarShardTable {
  readonly shards: readonly StarShard[];
  readonly flatCount: number;
  private readonly starts: number[];

  constructor(shards: readonly StarShard[]) {
    this.shards = [...shards];
    this.starts = [];
    let total = 0;
    for (const s of this.shards) {
      if (s.positions.length !== s.count * 3 || s.sid.length !== s.count) {
        throw new Error(
          `star shard '${s.key}': count ${s.count} disagrees with `
          + `positions ${s.positions.length} / sid ${s.sid.length}`,
        );
      }
      this.starts.push(total);
      total += s.count;
    }
    this.flatCount = total;
  }

  /** Flat Target idx of `(shard, local)`; -1 when either is out of range. */
  flatIndexOf(shard: number, local: number): number {
    if (shard < 0 || shard >= this.shards.length) return -1;
    if (local < 0 || local >= this.shards[shard].count) return -1;
    return this.starts[shard] + local;
  }

  /** Shard + shard-local index of a flat Target idx; null out of range. */
  shardLocalOf(flat: number): { shard: number; local: number } | null {
    if (flat < 0 || flat >= this.flatCount) return null;
    let shard = 0;
    while (shard + 1 < this.starts.length && flat >= this.starts[shard + 1]) shard++;
    return { shard, local: flat - this.starts[shard] };
  }

  /** Absolute position of flat idx `flat` — chunk origin plus the
   *  chunk-local value, summed per axis in float64. */
  absolutePositionInto(
    flat: number,
    out: { x: number; y: number; z: number },
  ): boolean {
    const at = this.shardLocalOf(flat);
    if (at === null) return false;
    const s = this.shards[at.shard];
    const i = at.local * 3;
    out.x = s.chunkOrigin[0] + s.positions[i];
    out.y = s.chunkOrigin[1] + s.positions[i + 1];
    out.z = s.chunkOrigin[2] + s.positions[i + 2];
    return true;
  }
}
