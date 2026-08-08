# Star population shards

A star population (the AT-HYG catalog today; an LMC/SMC field later) is
a **shard of the star kind, never a new kind**
(`docs/architecture-modularity.md` § Tier 3). `star-shards-pure.ts`
(+ test) is the contract, exercised with the catalog as shard 0 before
any second population ships; adding one must be a data-only addition —
a shard entry inside the star module (`../star-module.ts`), zero
contract or shell edits.

- **Flat Target.idx space.** Flat indices concatenate the shards in
  order (`StarShardTable`), so shard 0's local indices ARE its flat
  indices and a later shard can never renumber an earlier one. The
  star module holds the table; `Target {kind:'star'}` stays a single
  flat integer everywhere else.
- **Per-shard SID columns.** Each shard carries its own frozen SID
  column; the kind's resolver domain is their flat-order concatenation
  (`StarShardTable.sids` — the sole shard's column by reference), so
  the SID resolver and the URL wire need no shard awareness.
- **Chunk-local coordinates — the format law.** Shard positions are
  float32 RELATIVE to a float64 chunk origin. Float32 absolute
  coordinates quantise to ~32 pc at 306 Mpc (pinned in the test) —
  useless under camera-anywhere; chunk-local values stay small, so
  per-vertex float32 is exact at every scale. Shard 0's origin is zero:
  the catalog's Sol-centred grid doubles as its chunk-local frame. Same
  pattern as the dust chunks and the planet field's float64 masters.
- **Shard-aware recentring.** `shardRecentreEager` is the
  rewrite-or-defer rule: a deferred shard renders through a float32
  shard-origin offset whose error is `FLOAT32_EPS · |origin distance|`,
  sub-pixel from every viewpoint outside the shard's bounding sphere
  plus a solved clearance — so a recentre at Sol never pays an LMC
  buffer rewrite, and a recentre into the LMC rewrites it exactly.
  With the single catalog shard the rule answers eager for every
  in-catalog origin, which is today's whole-buffer `StarFrame.rewriteAt`
  behaviour; the recentre fan-out consults it when the second
  population wires its own buffers in.

`CATALOG_BOUNDING_RADIUS_PC` is shard 0's extent AND the star
pipeline's bounding-sphere radius — one constant, imported by both.
