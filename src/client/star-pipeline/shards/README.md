# Star population shards

A star population (the AT-HYG catalog today; an LMC/SMC field later) is
a **shard of the star kind, never a new kind**
(`docs/architecture-modularity.md` § Tier 3). This folder is the format
+ mapping contract, specified and exercised with the catalog as shard 0
before any second population ships.

```
star-shards-pure.ts (+ test)   StarShard, catalogShard, shardRecentreEager,
                               FLOAT32_EPS / DEFER_MAX_ERROR_PX /
                               CATALOG_BOUNDING_RADIUS_PC.
star-shard-table.ts (+ test)   StarShardTable — the flat Target.idx space.
                               Stateful (memoised SID domain), so it sits
                               outside the -pure module.
star-shard-mock.ts             test-only StarShard factory.
```

## Flat Target.idx space

Flat indices concatenate the shards in order (`StarShardTable`), so
shard 0's local indices ARE its flat indices and a later shard can never
renumber an earlier one. The star module holds the table; `Target
{kind:'star'}` stays a single flat integer.

The constructor copies the shard list and rejects a shard whose
`positions` / `sid` lengths disagree with its `count` — a shard is
assembled from a header count plus separately-fetched columns, and a
silent mismatch would shift every later shard's SID domain by the
difference.

## Per-shard SID columns

Each shard carries its own frozen SID column; the kind's resolver domain
is their flat-order concatenation (`StarShardTable.sids` — the sole
shard's column by reference, no 313k copy), so the SID resolver and the
URL wire need no shard awareness.

## Chunk-local coordinates — the format law

Shard positions are float32 RELATIVE to a float64 chunk origin. Float32
absolute coordinates quantise to ~32 pc at 306 Mpc (pinned in the test)
— useless under camera-anywhere; chunk-local values stay small, so
per-vertex float32 is exact at every scale. Shard 0's origin is zero:
the catalog's Sol-centred grid doubles as its chunk-local frame. Same
pattern as the dust chunks and the planet field's float64 masters.

## Shard-aware recentring

`shardRecentreEager` is the rewrite-or-defer rule. A deferred shard
renders through a float32 shard-origin offset of magnitude `d`, so its
worst-case position error is `FLOAT32_EPS · d`; a camera near the new
origin sees the shard no closer than `d − R`, putting the on-screen
error at `FLOAT32_EPS · d · angularToPx / (d − R)` px. Eager exactly
when that reaches `DEFER_MAX_ERROR_PX` — so a recentre at Sol never pays
an LMC buffer rewrite, and a recentre into the LMC rewrites it exactly.

**Precondition: the camera is near the render origin.** The bound is
evaluated once per recentre against the new origin, not per frame
against the camera, so a camera that closes on a deferred shard *without*
provoking a recentre exceeds it. The focal anchor policy holds the
precondition (the origin IS the focused object) and free-fly's planned
`follow` policy holds it by construction
(`docs/architecture-modularity.md` § Free-fly constraints); an anchor
policy that lets the camera wander far from the origin would need the
rule re-evaluated per frame.

With the single catalog shard the rule answers eager for every
in-catalog origin, which is today's whole-buffer `StarFrame.rewriteAt`
behaviour; the recentre fan-out consults it when the second population
wires its own buffers in.

## What is NOT shard-aware yet

The design goal is that a second population costs data plus a shard
entry and nothing else (`docs/architecture-modularity.md` § Tier 3).
What landed here is the format, the flat-index mapping, and the SID
domain — `StarKindModule.sids()` is the only leg routed through the
table. These still read `catalog` directly at a flat index and must be
migrated with the first second population:

- `../star-module.ts` — `pinnable`, `focusable.anchorInto` /
  `localPositionInto`, `displayName`, and the `card()` / `hover()`
  providers all bound-check against `catalog.count`.
- `../../main.ts` — `idMaps.starCount = catalog.count`, which
  `../../util/url-state/url-state.ts` uses to reject out-of-range star
  refs, so a shard-1 focus would not round-trip through the URL.
- `../star-frame/` — `StarFrame` owns `catalog.positions` as one buffer;
  per-shard instancing and the deferred-rewrite uniform path arrive with
  those buffers.

`CATALOG_BOUNDING_RADIUS_PC` is shard 0's extent AND the star pipeline's
bounding-sphere radius — one constant, imported by both plus the
pipeline test. The dust particle layer's like-valued never-cull sphere
is unrelated and deliberately not unified.
