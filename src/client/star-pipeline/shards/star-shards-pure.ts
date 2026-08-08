// Population-shard contract for the star kind: shard→flat Target.idx
// mapping, chunk-local coordinates over float64 chunk origins, per-shard
// SID columns, and the recentre eagerness rule. See ./README.md § Population shards.

import type { Catalog } from '../../loaders/catalog-loader';

export const FLOAT32_EPS = 2 ** -23;

/** Largest on-screen error (CSS px) a shard whose recentre rewrite was
 *  deferred may show — the sub-pixel bound the eagerness rule solves
 *  against. */
export const DEFER_MAX_ERROR_PX = 0.5;

/** Shard 0's bounding-sphere radius: the catalog population's extent
 *  about Sol, shared with the star pipeline's bounding sphere. */
export const CATALOG_BOUNDING_RADIUS_PC = 60_000;

/** One star population. A shard is data, never a kind: it brings its
 *  own artifact, chunk origin, and SID column, and the star module maps
 *  it into the flat Target.idx space (`StarShardTable`). */
export interface StarShard {
  /** Stable shard tag — 'catalog' is shard 0 (the AT-HYG population). */
  readonly key: string;
  readonly count: number;
  /** xyz triples, float32, RELATIVE to `chunkOrigin`. Chunk-local is
   *  the format law: float32 absolute coordinates quantise to ~32 pc at
   *  Local-Group-plus range (pinned in the test), useless when the
   *  camera flies in; local values stay small, so per-vertex float32 is
   *  exact at every scale. */
  readonly positions: Float32Array;
  /** Absolute chunk origin, float64 per axis. Shard 0's is zero — the
   *  catalog's Sol-centred grid doubles as its chunk-local frame. */
  readonly chunkOrigin: readonly [number, number, number];
  /** Bounding-sphere radius about `chunkOrigin` (pc); the recentre
   *  eagerness rule keys on it. */
  readonly boundingRadiusPc: number;
  /** Frozen per-shard SID column (docs/sid.md § 7), localIndex-ordered;
   *  the kind's flat domain is the shard columns concatenated in shard
   *  order. */
  readonly sid: Uint32Array;
}

/** The loaded catalog as shard 0. */
export function catalogShard(catalog: Catalog): StarShard {
  return {
    key: 'catalog',
    count: catalog.count,
    positions: catalog.positions,
    chunkOrigin: [0, 0, 0],
    boundingRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
    sid: catalog.sid,
  };
}

/** Whether a recentre onto `(ox, oy, oz)` must rewrite this shard's
 *  buffers eagerly, or may defer. A deferred shard renders through a
 *  float32 shard-origin offset of magnitude d = |newOrigin −
 *  chunkOrigin|, so its worst-case position error is FLOAT32_EPS·d; a
 *  camera near the new origin sees the shard no closer than
 *  (d − boundingRadius), putting the on-screen error at
 *  FLOAT32_EPS·d·angularToPx / (d − R) px. Eager exactly when that
 *  crosses DEFER_MAX_ERROR_PX — i.e. when the origin lands inside the
 *  shard or within the solved clearance of its surface. */
export function shardRecentreEager(
  shard: StarShard,
  ox: number,
  oy: number,
  oz: number,
  angularToPx: number,
): boolean {
  const d = Math.hypot(
    ox - shard.chunkOrigin[0],
    oy - shard.chunkOrigin[1],
    oz - shard.chunkOrigin[2],
  );
  const clearancePc = (FLOAT32_EPS * d * angularToPx) / DEFER_MAX_ERROR_PX;
  return d - shard.boundingRadiusPc <= clearancePc;
}

/** Flat Target.idx space over an ordered shard list: flat indices
 *  concatenate the shards in order, so shard 0's local indices ARE its
 *  flat indices and a later shard's population shift can never renumber
 *  an earlier one. */
export class StarShardTable {
  readonly shards: readonly StarShard[];
  readonly flatCount: number;
  private readonly starts: number[];
  private flatSids: Uint32Array | null = null;

  constructor(shards: readonly StarShard[]) {
    this.shards = shards;
    this.starts = [];
    let total = 0;
    for (const s of shards) {
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

  /** The kind's SID domain in flat order — the sole shard's column by
   *  reference, else the columns concatenated once and cached. */
  sids(): Uint32Array {
    if (this.shards.length === 1) return this.shards[0].sid;
    if (this.flatSids === null) {
      this.flatSids = new Uint32Array(this.flatCount);
      for (let i = 0; i < this.shards.length; i++) {
        this.flatSids.set(this.shards[i].sid, this.starts[i]);
      }
    }
    return this.flatSids;
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
