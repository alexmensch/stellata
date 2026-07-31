# Util

Project-agnostic plumbing. Each topic owns a subfolder; the parent
also hosts `astronomy-constants.ts`, the single source of truth for
physical / astronomical constants shared across the client runtime,
build scripts, tests, and shader uniforms.

- `astronomy-constants.ts` — `AU_PER_PC` / `AU_PC` / `AU_KM` / `KM_PC` /
  `R_SUN_PC` / `SUN_ABSMAG_V` / `MIN_PHYSICAL_RADIUS_R_SUN` / `ARCSEC_TO_RAD` /
  `J2000_JD` / `J2000_OBLIQUITY_RAD` / `DAYS_PER_JULIAN_YEAR` /
  `LIGHT_TIME_PER_AU_S`. Import from here
  rather than re-derive — drift between sites is the failure mode this module
  is designed to prevent.
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
- `kepler-solver.ts` — `solveKepler(M, e)` + `wrapAngle(a)` Newton
  solver shared between Sol's planet ephemerides (e ≲ 0.25) and binary
  orbits (e up to ~0.95). 50-iter, 1e-12 tolerance defaults.
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
  of another epoch: the IAU 1976 (Lieske) angles
  (`precessionAnglesFromJ2000`), the rotation they compose
  (`precessionRotationFromJ2000`), and its forward / inverse application
  to a direction or a `SkyPosition`. `besselianEpochToJd` supplies
  `B1875_JD`, the equinox the IAU constellation boundaries are drawn at —
  the θ sign and the epoch are both silent-failure modes, documented in
  `../constellation-boundaries/iau-geometry/README.md` § B1875.
- `astronomy-constants.ts` — canonical values, one definition each, so
  client / build-script / shader consumers can't drift on precision.
  `RA_HOURS_TO_DEG` is the hours→degrees factor every catalogue RA column
  and sexagesimal boundary coordinate goes through; tests import it
  rather than restating 15.
- `pending-click.ts` — single/double-click disambiguator (hold a
  click for the double window, fire single on expiry). Drives canvas
  clicks in both camera modes.
- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `sid-resolver/` — runtime SID → `{kind, localIndex}` resolution over
  attached artifacts (docs/sid.md § 8).
- `url-state/` — `?v=` URL wire format (v1/v2/v3) and the address-bar
  round-trip.
