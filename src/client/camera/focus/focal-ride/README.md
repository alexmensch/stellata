# Focal ride

Keeping a moving focused object under the camera: the per-frame ride step
and the anchor policy that keeps the floating origin on the focal object as
it travels. The focus state it rides lives in the parent (`../README.md`).

## Files

- `focal-ride-pure.ts` (+ test) — `focalRideStep`, one frame of the ride
  both moving-focal kinds and the binary walk drive, plus
  `shouldRecenterFocalOrigin`. The seed frame measures from `target` in
  navigate and from `cameraPosition` in observe, because observe parks the
  camera — not the target — on the object; [Focal-frame ride](../../../binaries/README.md#focal-frame-ride-no-rebase)
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
([Focal-frame ride](../../../binaries/README.md#focal-frame-ride-no-rebase) — kind-agnostic, no
per-kind pin), which reseeds the ride when it fires.
