// The star kind's population-shard format: chunk-local coordinates over a
// float64 chunk origin, per-shard SID columns, and the recentre eagerness
// rule. See ./README.md.

import type { Catalog } from '../../loaders/catalog-loader';

export const FLOAT32_EPS = 2 ** -23;

/** Sub-pixel bound the eagerness rule solves against — raising it trades
 *  visible drift on a deferred shard for fewer buffer rewrites. */
export const DEFER_MAX_ERROR_PX = 0.5;

/** Shard 0's extent AND the star geometry's `boundingSphere` radius — the
 *  sphere must cover the catalog or three.js frustum-culls live stars.
 *  Unrelated to the dust layer's like-valued never-cull sphere. */
export const CATALOG_BOUNDING_RADIUS_PC = 60_000;

/** One star population: its own artifact, chunk origin, and SID column,
 *  mapped into the flat Target.idx space by `StarShardTable`. */
export interface StarShard {
  /** Stable shard tag — 'catalog' is shard 0 (the AT-HYG population). */
  readonly key: string;
  readonly count: number;
  /** xyz triples RELATIVE to `chunkOrigin`, never absolute
   *  (./README.md § Chunk-local coordinates). */
  readonly positions: Float32Array;
  /** Absolute origin, float64 per axis — a Float32Array here would
   *  reintroduce the quantisation the format exists to avoid. */
  readonly chunkOrigin: readonly [number, number, number];
  /** Bounding-sphere radius about `chunkOrigin` (pc). */
  readonly boundingRadiusPc: number;
  /** Frozen SID column (docs/sid.md § 7), localIndex-ordered. */
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

/** Whether a recentre onto `(ox, oy, oz)` must rewrite this shard's buffers
 *  eagerly, or may defer and render through a float32 origin offset.
 *  Assumes the camera sits near the new origin — see ./README.md
 *  § Shard-aware recentring for the error model and that precondition. */
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
