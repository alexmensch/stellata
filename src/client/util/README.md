# Util

Project-agnostic plumbing. Each topic owns a subfolder; the parent
also hosts `astronomy-constants.ts`, the single source of truth for
physical / astronomical constants shared across the client runtime,
build scripts, tests, and shader uniforms.

- `angles.ts` (+ test) — `wrapAngle(a)` / `wrapDegrees(d)`, the signed
  wraps onto (−π, π] and (−180, 180]. Both reduce by one `floor`, not by
  a while-loop: Earth's spin accumulates ~6.6e8 degrees at the model
  clock's bounds and a loop would iterate millions of times to bring that
  back. `wrapAngle` used to live in `kepler-solver.ts`.
- `astronomy-constants.ts` (+ test) — `AU_PER_PC` / `AU_PC` / `AU_KM` /
  `KM_PC` / `R_SUN_PC` / `SUN_ABSMAG_V` / `MIN_PHYSICAL_RADIUS_R_SUN` /
  `ARCSEC_TO_RAD` / `J2000_JD` / `J2000_OBLIQUITY_RAD` /
  `DAYS_PER_JULIAN_YEAR` / `LIGHT_TIME_PER_AU_S` / `RA_HOURS_TO_DEG`.
  Canonical values, one definition each, so client / build-script /
  shader consumers can't drift on precision — import from here rather
  than re-derive. `RA_HOURS_TO_DEG` is the hours→degrees factor every
  catalogue RA column and sexagesimal boundary coordinate goes through;
  tests import it rather than restating 15.
- `attribute-upload.ts` (+ test) — partial GPU re-upload for an
  instanced attribute whose per-frame writes land on a small, fixed
  subset of items. `DirtyItemUploader` diffs those items against the
  previous flush and adds three.js update ranges over what moved,
  uploading nothing when nothing did; `uploadFull` is the whole-buffer
  flush, which must also be how any wholesale rewrite flushes, since a
  non-empty range list wins over the full array. `MAX_PARTIAL_RANGES`
  caps the driver-call budget, `RANGE_MERGE_GAP_ITEMS` the clean payload
  worth carrying to avoid an extra call. The uploader binds its
  attribute at construction and reads `itemSize` + the backing array off
  it, so the ranges it emits cannot address a different stride than the
  buffer they upload into. Its shadow is NaN-seeded at construction and
  by `reset()` — NaN compares unequal to everything, so the first flush
  after either reports every tracked item, which is the truth in both
  cases (no GPU buffer yet / a stale one). Consumer + the invariants it
  rides on: `../binaries/README.md` § Partial re-upload.
- `ecliptic-frame.ts` (+ test) — `icrsToEcliptic` / `eclipticToIcrs`, the
  fixed `Rx(±ε)` pair about the J2000 obliquity, on plain `{x, y, z}`
  and safe to alias `out` with `v` (the moon resolver does). This is the
  scalar form; `orbit-rings-layer.ts`'s `refPlaneToEclipticQuat` is the
  quaternion one the ring vertices ride, and the two are parity-pinned
  against each other. Sign trap: the north ecliptic pole comes back with
  a NEGATIVE y — see `../solar-system/ephemerides/README.md` § Gotchas.
- `equatorial-basis.ts` — the ICRS tangent basis every sky-frame
  projection resolves against: `equatorialTangentBasisRad` (core) /
  `equatorialTangentBasis` (degrees) / `equatorialTangentBasisAt(x, y, z)`
  (from an equatorial Cartesian position, `null` at the origin) return
  `{u, east, north}` with east = ∂u/∂α / cos δ — never divided by cos δ,
  so it stays a unit vector through the poles. `unitVectorFromRaDec` is
  the `u` component alone and `raDecFromUnitVector` its inverse (ra
  wrapped to [0, 360)); `SkyPosition` is the `{raDeg, decDeg}` pair both
  sides speak. Shared by the catalog build's PM propagation +
  space-motion velocity (`scripts/catalog/distance/direction-cascade.ts`), the
  companion tangent-projection (`scripts/catalog/companions/companion-promotion.ts`),
  and the runtime Tier-1 sky→ICRS orbit projection
  (`../binaries/binary-orbit-pure.ts`). `scripts/local-group/`'s
  `skyBasis` deliberately does NOT ride this: it seeds a rotation
  quaternion and picks a canonical orientation at the pole, which this
  helper leaves to the caller's ra.
- `fullscreen-pass.ts` (+ test) + `fullscreen-pass.vert.glsl` —
  `fullscreenTriangleGeometry()` and the matrix-free vertex stage every
  fullscreen shader pass shares (the extinction A_V prepass, the HDR
  tone-map resolve). The geometry carries `aPosition` and **must stay
  indexed**: with no `position` attribute the renderer derives its draw
  count from `index.count`, so an un-indexed geometry silently draws
  nothing.
- `glsl-call-args.ts` (+ test) — `glslCallArgs(src, name)`, the top-level
  argument list of a call in shader source. Walks the parens rather than
  matching a regex, so a nested call in an earlier slot cannot split the list
  in the wrong place, and matches a **whole identifier** — callers assert on
  argument text, so a hit inside a longer name would pin a different call and
  still pass. The drift tests that pin what a shader passes where run on
  it — which alpha an occluder texel dims by
  (`../solar-system/planets/planet-mesh-layer.test.ts`), which emitters may
  claim lit-surface coverage (`../hdr/attachments/statistic-mask.test.ts`).
  Nothing at runtime reads shader text; this exists so those pins share one
  parser instead of one each.
- `kepler-solver.ts` (+ test) — `solveKepler(M, e)`, the Newton
  solver shared between Sol's planet ephemerides (e ≲ 0.25) and binary
  orbits (e up to ~0.95). 50-iter, 1e-12 tolerance defaults. Also the
  element↔state pair `orbitalStateToCartesian` and its inverse
  `cartesianToOrbitalElements` — the inverse is what lets a body
  positioned by a *series* rather than by elements still get an orbit
  ring that passes through it (the Moon; `../solar-system/ephemerides/README.md`
  § Orbit rings). The inverse also returns the eccentric anomaly, which
  the ring layer anchors its first vertex on; it comes out of `r` and
  `r·v` directly rather than from a second Kepler solve.
- `orbit-line.ts` — shared bits of the line overlays
  (`solar-system/ephemerides/orbit-rings-layer.ts`, `binaries/binary-orbit-path-layer.ts`,
  `solar-system/probes/probe-path-layer.ts`,
  `constellation-figure/constellation-figure-layer.ts`): the alpha-blended
  primitives `makeOrbitLineLoop` / `makeOrbitLine` (open polyline, for a
  traversed path with two ends) / `makeOrbitLineSegments` +
  `makeOrbitLineMaterial(color, opacity?)` (default `ORBIT_LINE_OPACITY`;
  `color` is an authored sRGB hex, mapped through the tone-map inverse so
  the line resolves at that appearance out of the HDR pass —
  `../hdr/README.md` § Chrome), its dashed sibling
  `makeDashedOrbitLineMaterial(color, dash, gap, opacity?)` — dash lengths
  in whatever unit the consumer's `material.scale` maps world distance into
  (so a pattern can be authored in screen pixels), and the consumer owns the
  cumulative `lineDistance` attribute because `computeLineDistances` resets
  the phase per segment pair (`../constellation-boundaries/README.md`
  § Chart-mode layer) — and the on-screen-size helpers `pixelsPerRadian`
  (+ `pixelsPerRadianFromFovRad` for callers holding the FOV in radians, and
  `pixelsPerRadianFromUniforms` for the `ScreenMetricUniforms` viewport / FOV
  slot pair every layer that sizes in screen pixels holds by reference —
  probe markers and trails, planet-body collapse, the boundary stipple) /
  `angularRadiusPx` the orbit
  layers use for their pixel-size visibility gate, plus the shared
  `FEATURE_LEGIBILITY_MIN_PX` floor + `isFeatureLegible` predicate that both
  the orbit-ring gate and the boundary-shell silhouette labels
  (`fresnel-shell/`) ride so their legibility cutoff can't drift. Also the
  anchored-line
  precision pair `bakeAnchoredLineVerts` / `trackAnchoredLine`: a loop
  whose centre rides far from the floating origin (a host star's ring
  under planet focus) keeps a float64 centre-relative master array and
  bakes its float32 GPU buffer renderer-local, rebaking once the centre
  drifts past `LINE_ANCHOR_MAX_DRIFT_PC` — otherwise the shader cancels
  two large float32 quantities per vertex and the line visibly jitters
  under camera motion at close framings (the Pluto-focus wobble).
- `precession.ts` (+ test) — ICRS/J2000 ↔ the mean equator and equinox
  of another epoch, in **two models with different validity windows**:
  - **IAU 1976 (Lieske)** — `precessionAnglesFromJ2000`, the rotation
    they compose (`precessionRotationFromJ2000`), and its forward /
    inverse application to a direction or a `SkyPosition`.
    `besselianEpochToJd` supplies `B1875_JD`, the equinox the IAU
    constellation boundaries are drawn at — the θ sign and the epoch are
    both silent-failure modes, documented in
    `../constellation-boundaries/iau-geometry/README.md` § B1875. Cubic
    polynomials: right for the 125 years back to B1875, arcminutes off at
    the model clock's bounds.
  - **Vondrák, Capitaine & Wallace 2011** — `longTermEclipticPole` /
    `longTermEquatorPole` / `longTermEquinox` and the two frames they
    build (`longTermEclipticRotationFromJ2000`,
    `longTermEquatorRotationFromJ2000`), valid ±200 kyr. This is the one
    the model clock's span needs: the lunar theory's equinox-of-date
    frame and Earth's own pole both read it.

  The two coexist deliberately and are pinned against each other inside
  the overlap (they agree to 0.15″ near the present, 0.37″ at B1875).
  Don't replace the Lieske path with the long-term one to "DRY them up" —
  the boundary geometry is pinned to arcsecond edge cases at B1875.
  Vondrák carries its own obliquity constant (84381.406″, IAU 2006) for
  the same reason: it is part of the published series, not a duplicate of
  `J2000_OBLIQUITY_RAD`.
- `pending-click.ts` — single/double-click disambiguator (hold a
  click for the double window, fire single on expiry). Drives canvas
  clicks in both camera modes.
- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `sid-resolver/` — runtime SID → `{kind, localIndex}` resolution over
  attached artifacts (docs/sid.md § 8).
- `url-state/` — `?v=` URL wire format (v1/v2/v3) and the address-bar
  round-trip.
