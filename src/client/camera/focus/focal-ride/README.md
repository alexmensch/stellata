# Focal ride

Keeping a moving focused object under the camera: the per-frame ride step
and the anchor policy that keeps the floating origin on the focal object as
it travels. The focus state it rides lives in the parent (`../README.md`).

## Files

- `focal-ride-pure.ts` (+ test) — `focalRideStep`, one frame of the ride
  both moving-focal kinds and the binary walk drive, plus
  `shouldRecenterFocalOrigin`. The seed frame measures from `target` in
  navigate and from `cameraPosition` in observe, because observe parks the
  camera — not the target — on the object; [Binary focal ride](#binary-focal-ride-no-rebase)
  is the authority.
- `focal-anchor-policy.ts` (+ test) — `makeFocalAnchorPolicy`, the
  `AnchorPolicy` (`../../../frame/README.md`) that keeps the floating
  origin on the focal object under time advance. Deps are live
  references + two gate closures; the shell supplies which controllers
  count as camera-busy ([Moving-focal ride](#moving-focal-ride)).

## Moving-focal ride

A focused planet sweeps its orbit and a focused probe runs its
trajectory, both fast under scrubber fast-forward. `applyMovingFocalRide`
in `stellata.ts` — the sibling of the binary focal-frame ride, over the
shared `focalRideStep` — translates camera + orbit target + in-flight
pose caches by the object's per-frame local-position delta, so pan
offsets survive and the object stays glued to `controls.target` at any
rate. That is what makes the probe flythrough hold.

It is one slot for both kinds, read through
`focusables[kind].localPositionInto`, with membership declared as
`moving: true` in `KIND_TRAITS`. Two things keep it correct:

- **The ride reseeds on every `'focus'` event.** Each hard focus
  recentres the origin, staleing the cached last position — and it is
  also what makes the shared slot safe when the kind changes but the
  index collides (planet 3 → probe 3), since the slot is keyed on index
  alone.
- **It must run after every moving-body field has written this frame's
  positions.** The probe and planet module layers register in roster
  order ahead of every inline layer, and the ride sits in the first
  inline entry (with the planet mesh update, which needs the post-ride
  camera) — so both fields are fresh when it fires. One frame of lag is
  invisible at 1× and a visible offset at high fast-forward.

Float32 precision as the object travels far from the focus-time origin
is held generically by the origin-follow recentre
([Binary focal ride](#binary-focal-ride-no-rebase) — kind-agnostic, no
per-kind pin), which reseeds the ride when it fires.

## Binary focal ride (no rebase)

The walk applies the barycentric split in EVERY regime — there is no
focal rebase. Focusing a pair member writes byte-identical positions to
being unfocused, so focus→unfocus is a pure state change with no
position discontinuity. Instead of rebasing the focal to the local
origin to match the disc shader's `uPinFocusToCenter`, the **camera
rides the focal star's perturbed position**: the integration shell
(`stellata.ts`, `applyFocalFrameRide`) translates `camera.position` +
`controls.target` (and any in-flight camera-transition pose caches) by
the focal's per-frame orbital drift, so `controls.target` stays glued to
the star and `lookAt(target) == star` keeps the pin substitution valid.

Both rides reach the camera through one `applyRideDelta` helper, which
also hands the delta to the gate and the cadence
([The focal ride](../../../render-gate/README.md#the-focal-ride)).

`focalPerturbationInto(focalIdx, t, out)` supplies that drift in
**float64**: it replays the focal's slot-chain ([Walk-active LOD](../../../binaries/README.md#walk-active-lod)) in
double precision and returns the focal's total displacement from its
catalog baseline — matching the walk's float32-written slot within the
position quantum, continuous in `t`. `setFocus` reads it to snap
`controls.target` onto the star's live position; a per-frame delta then
drives the ride. On the frame the focal changes, the ride re-snaps
`controls.target` onto the star's **live `_localPositions` slot** rather
than trusting that focus-entry snap — under fast scrub sim-time advances
between the focus event and the next frame, so the event-time sample goes
stale and would leave the star a fixed offset off-centre. That re-snap
measures from the CAMERA in observe mode: there `controls.target` is the
look-direction pin one parsec ahead of the camera (not on the star), so
re-snapping against it would drag the star-parked camera a parsec off the
focal, while the camera is the thing observe parks on the star. Measuring
from the camera also repairs a park taken on a **cold load**, where observe
parked before this field attached and the sample was the bare baseline with
no orbital displacement; the steady leg only tracks CHANGES, so nothing
later repairs that offset and the seed frame is the one chance. Left
uncorrected it disengages the pin on the next observe→navigate exit. The
pure step math is `focalRideStep`. CPU consumers (focus ring,
distance vector, HUD shafts, hover picker) read the perturbed
`_localPositions` and project through the same `lookAt(target)` camera,
so they land on the disc without any rebase. The ride is skipped during
warp (the warp owns the camera and tracks the live buffer itself).

**Origin-follow (drift recentre).** The ride translates the camera to
follow the focal, so under fast scrub a far-orbiting focal (a planet
across its orbit; a wide binary) drags the camera tens of AU from the
fixed focus-time origin — reviving the float32 modelview cancellation
the floating origin exists to prevent (a growing wobble on the focal
body). The focal anchor policy
(`focal-anchor-policy.ts`, applied by
`FloatingOrigin.tick()` each frame) recentres the origin back onto the
look target once camera-from-origin exceeds
`FOCAL_ORIGIN_DRIFT_RATIO × eye distance` (`focal-ride-pure.ts`),
restoring camera-from-origin ≈ eye distance. It is kind-agnostic —
keyed on camera geometry, not the focus kind — so every hard focus
benefits with no per-kind code. The shared origin is the one precision
lever a per-shader pin (`uPinFocusToCenter`) can't generalise; that pin
still handles the separate close-approach-at-origin case ([Pin-to-center](../README.md#pin-to-center-upinfocustocenter)).
