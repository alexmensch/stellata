# Frame services

Engine services for the renderer's floating local frame
(`docs/architecture-modularity.md` § Tier 1): `FloatingOrigin` — the
floating origin's owner, recentre fan-out, and anchor-policy seam — and
the shared view/screen uniform map every render pass holds by
reference. Star-specific frame state (the local-position buffer, epoch
advance, proximity queries) stays on `StarFrame`
(`../star-pipeline/star-frame/README.md`), which consumes this service.

`FloatingOrigin` is kind-agnostic; `buildSharedUniforms` is **not yet**
— it seeds star-specific slots and imports `../star-pipeline/`
(`makeColorLutTexture`, `MIRROR_CAPACITY`, the `PerceptualDiscUniforms`
shape it `satisfies`). The map is the union of what its consumers read,
so that residual belongs to the star kind module, not here; it clears
when the star kind lands as a module and owns its own slots. Nothing
outside the map's own construction may add star knowledge to this
folder in the meantime.

## Files in this area

```
src/client/frame/
  floating-origin.ts (+ test)     FloatingOrigin — worldOffset, the
                                  uWorldOffset shader mirror, the
                                  ordered onRecenter fan-out, and the
                                  AnchorPolicy seam tick() applies. The
                                  test pins delta math (float64),
                                  listener order, the no-op path, and
                                  the policy tick.
  shared-uniforms.ts (+ test)     buildSharedUniforms — the one uniform
                                  map all three star passes (and the
                                  planet body field + Milky Way pass)
                                  share by reference. The test pins
                                  seeding + the perceptual-disc slot
                                  identities the planet pipeline picks
                                  out.
```

## Floating origin

`FloatingOrigin` owns `worldOffset` — the absolute-space coordinate
sitting at the renderer's local (0,0,0) — and is the single writer of
the `uWorldOffset` uniform the shaders use to reconstruct absolute
positions. `recenterTo(newOrigin)` computes the frame delta in JS
Number precision (= float64) — the precision contract the whole
floating-origin design rests on (`../README.md` § Floating origin) —
then fans out to the `onRecenter` listeners in registration order and
returns the delta (shared scratch; null on no-op, in which case no
listener fires).

### Recentre fan-out — order is load-bearing

The integration shell registers three listeners, in this order:

1. **Star buffer rewrite** — `StarFrame.rewriteAt(origin)` rewrites
   `localPositions` in float64 per axis and clears any stale flag a
   same-frame epoch advance left (the one-rewrite-per-frame coalescing
   invariant, `../star-pipeline/star-frame/README.md`).
2. **Camera / orbit-target shift** — both translate by the delta so the
   user sees no jump, only numerical precision improves.
3. **Scene-layer fan-out** — `SceneLayerRegistry.recenterAll`; layers
   holding local-frame positions (planet hosts, binary baselines)
   re-derive them.

Later listeners read state the earlier ones just rewrote; reordering
them reintroduces one-frame-stale reads.

### Anchor policy

`AnchorPolicy` is the pluggable answer to "where should the origin sit
this frame" (`docs/architecture-modularity.md` § Free-fly constraints:
`focal` today, `follow` for free-fly later). `tick()` — called once per
frame by `animate()`, before `flushLocalPositions` — asks the policy
for a desired origin and recentres onto it. The service knows nothing
about cameras or focus: the focal policy is
`makeFocalAnchorPolicy` (`../camera/focus/focal-anchor-policy.ts`),
and the shell supplies only which controllers count as camera-busy.

**`tick()`'s return is the policy-recentre signal, not `onRecenter`.**
The shell reseeds the moving-focal ride only when `tick()` reports a
recentre; an externally triggered recentre (focus mutation, warp
mid-fly pivot, URL restore — all via `recenterOrigin` →`recenterTo`)
must not reseed, because `focalRideStep` owns those transitions.

## Shared uniforms

`buildSharedUniforms` (`shared-uniforms.ts`) returns the one uniform
map the star disc, glow, and core-mask passes spread into their
materials — `uRenderMode` is the only divergent slot, bound per
material by `StarPipeline`. Every other consumer picks slots out of the
same object **by reference**, so a single write reaches all of them
with no bookkeeping: `FilterController` (the filter / instrument /
render knobs), `PlanetBodyField` (via `pickPerceptualDiscUniforms` +
`pickChartDiscUniforms`), `MilkyWay` (`uLimitMag`, for its chart-mode
isobar contour only — the band's own brightness is photometric),
`StarLocalMirror`, `ExtinctionPrepass`, `FloatingOrigin`
(`uWorldOffset`), `StarFrame` (`uFovYRad` / `uViewport` for its
windows), `DustParticleLayer`, `Picker`, and every kind module through
`KindContext.sharedUniforms`. The three renderer-derived seeds (pixel
ratio, FOV, viewport) are arguments; the rest come from
`DEFAULT_FILTER` / `STAR_RENDER_DEFAULTS` and the star pipeline's own
constants.

`uSizeSpan` is the exception to "comes from `DEFAULT_FILTER`": the
footprint window is no longer a `FilterState` field, so it seeds
through `sizeSpanOf(DEFAULT_FILTER)` — the instrument record is its
only authority (`../filters/README.md` § The multiplier is the ONLY
footprint control).

The one set of slots this map does **not** own is
`HdrPipeline.emitterUniforms` — `uExposure`, `uOmegaPxArcsec2`,
`uOmegaSummationArcsec2`, `uWhitePoint`, `uHighlightDesat`,
`uHdrTarget` — passed in as the `hdr`
option and spread in by reference. `HdrPipeline` rewrites `uHdrTarget`
on every seam / resolve / chart-mode change, so copying the values
instead of sharing the objects would leave the star passes tone-mapping
inline into an already-tone-mapped target. Pinned in the test; see
`../hdr/emission/README.md` § Unit.

Many slots are star-specific (`uColorLut`, `uLocalMemberIdx`,
`uPinFocusToCenter`, …) — the map is the union of what its consumers
read, and narrowing per consumer happens at the type level
(`PerceptualDiscUniforms`, `DustParticleSharedUniforms`,
`StarPhysicsUniforms`), not by cloning slots.

The WebGPU dual boot mirrors this map as TSL uniform nodes
(`../webgpu/README.md` § Shared uniform nodes); a key-parity test pins
the mirror, so adding a slot here fails CI until the node counterpart
exists.
