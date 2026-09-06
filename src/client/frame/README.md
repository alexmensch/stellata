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

**Why it exists.** Close-range orbit of a star far from Sol used to
jitter visibly because Three.js composes its `modelViewMatrix` at
float32 precision. At 1 kpc from Sol, the translation column quantises
to ~10⁻⁴ pc — 2–3% of the min-orbit radius — so every frame the
projected position snapped around by a few pixels. The fix is to run the
renderer in a **floating local frame** whose origin tracks the currently
focused star.

The key precision win: the big `absolute − offset` subtractions happen
in JS float64 on the CPU, producing small float32 deltas near zero with
~10⁻³⁸ resolution. The GPU's modelview matrix then only carries
kilo-parsec-scale values when the camera is far from the local origin
(i.e. zoomed out, where pixel-level jitter is imperceptible anyway).

`FloatingOrigin` owns `worldOffset` — the absolute-space coordinate
sitting at the renderer's local (0,0,0), starting at Sol — and is the
single writer of the `uWorldOffset` uniform the shaders use to
reconstruct absolute positions. `recenterTo(newOrigin)` computes the
frame delta in JS Number precision (= float64) — the precision contract
the whole design rests on — then fans out to the `onRecenter` listeners
in registration order and returns the delta (shared scratch; null on
no-op, in which case no listener fires).

The star buffer itself lives on `StarFrame`
(`../star-pipeline/star-frame/README.md`): `localPositions` (exposed via
`stellata.localPositions`), a `Float32Array` of
`catalog.positions − worldOffset` bound to the `iPosition` instance
attribute, which is what every overlay and pick path projects through.

`Stellata.recenterOrigin(newOrigin)` (exposed via the `FrameAnchor`
seam) delegates here. Its two callers are
`FocusController.recenterFocusToStar` (focus mutations) and
`WarpController.tryMidFlyRecentre` (mid-flight pivot onto the
destination); the focal-drift recentre runs through the anchor policy's
per-frame `tick()` instead.

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

### Focus, unfocus, and the default load

`FocusController.setFocus(idx)` calls `recenterOrigin` on focus, then
snaps `controls.target` onto the focal star's **live** local position
(catalog baseline + orbital perturbation), not the bare local origin —
a binary member sits at its perturbed position. For a non-orbiting star
that live position IS the local origin. **Unfocus does *not* recenter**
— `worldOffset` stays at the former focal object so
camera/target/iPosition all remain in their float32-clean local frame.
Recentering on unfocus used to cause a visible jump (the `idx===null`
branch shifted `target` by the focal star's full world position,
breaking the pin invariant and re-introducing cancellation in the
projection chain).

**Focal-frame ride.** A focused binary member drifts along its orbit
each frame; the shell translates `camera.position` + `controls.target`
(and in-flight camera-transition pose caches) by that per-frame drift
so the star stays under the camera and the pin stays engaged. Focus and
unfocus of a pair member therefore cause no position discontinuity —
see `../binaries/README.md` § Focal-frame ride.

**Default-load** auto-engages `setFocus(catalog.solIndex)` before the
first frame so URL-less loads start with the pin engaged and the per-Sol
orbit floor in effect, matching every other entry point (warp arrival,
observe→navigate, search-select). The URL encoder treats Sol as the
canonical default focus and *omits* the field when focused on Sol;
"explicitly unfocused" rides a separate presence bit so the three states
(default-Sol / specific star / cleared) round-trip unambiguously.

### Implications for code that reads positions

- **Rendering / projection math** must use `stellata.localPositions`
  (same frame as `camera.position` and `controls.target`). The disc
  mask, focus ring, distance vector, constellation overlay, and all
  `Picker.pickStar` / `renderedSizePx` / `aimAtConstellation` paths
  do this.
- **Distance-from-Sol** (the distSol filter, the Sol locator-arrow
  label) must use `catalog.positions` *or* must compute
  `||localPosition + worldOffset||` in JS float64. (Hover-card and
  focus-card distances are camera-relative by design — they read the
  local frame directly.) The shader's
  distSol filter consumes a precomputed per-instance `iDistSol`
  attribute instead of `length(iPosition)`, because the latter is now
  a local-frame value. The Sol arrow uses the float64 sum approach so
  its distance label updates correctly under any focus.
- `starLocalPosition(i)` (formerly `starWorldPosition`) returns the
  local-frame vector — use it for camera math, never for Sol-distance.

### URL round-trip

The focused case needs the sender to normalise, because the two ends do
**not** recentre at the same moments. The receiver recentres onto the focus
the instant it applies; the sender's own recentre waits for the camera to
drift `FOCAL_ORIGIN_DRIFT_RATIO` × the eye distance, and until it fires the
moving-focal ride carries camera and target along with the object. Raw local
coordinates are therefore in a frame the receiver never rebuilds. The URL
writer serialises camera/target measured **from the focal object**
(`../util/url-state/README.md` § What counts as a camera move), which is
the frame the receiver does rebuild, and which a ride leaves untouched.

For unfocused-but-not-at-Sol, the URL serialises a `worldOffset` field
(FIELDS_V2 bit 20, vec3 Float32, appended to the end for forward-compat
with older clients). The encoder emits it when nothing is focused AND
`worldOffset` sits far enough from Sol to move the pose at this scale
(`../util/url-state/README.md` § What counts as a camera move); cam/tgt
then encode in the local frame
and round-trip with full Float32 precision. The loader applies
`setWorldOffset` *before* cam/tgt and resets cam/tgt to defaults so a
missing `view.cam` / `view.tgt` produces a sane pose in the new local
frame. Old URLs without `worldOffset` decode as Sol-anchored (legacy
behaviour).

The general design treats `worldOffset` as a free Float32 vec3 anchor
(not a catalog ref): future object types (clouds, planets, probes,
exoplanets) can each set it on focus without coupling to the star
catalog index space. Float32 precision is sufficient at any magnitude
because the user-visible pose is the cam/tgt offset *within* the
local frame, stored at full Float32 precision relative to the anchor.

## Shared uniforms

`buildSharedUniforms` (`shared-uniforms.ts`) returns the one uniform
map the star disc, glow, and core-mask passes spread into their
materials — `uRenderMode` is the only divergent slot, bound per
material by `StarPipeline`. Every other consumer picks slots out of the
same object **by reference**, so a single write reaches all of them
with no bookkeeping: `FilterController` (the filter / instrument /
render knobs), `PlanetBodyField` (via `pickPerceptualDiscUniforms` +
`pickChartDiscUniforms`), `MilkyWay` (`uLimitMag`, whose only consumer is the chart-mode isobar
branch — which has never drawn, so nothing rendered reads it; the band's
own brightness is photometric),
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
(`../webgpu/tsl/README.md` § Shared uniform nodes); a key-parity test pins
the mirror, so adding a slot here fails CI until the node counterpart
exists.
