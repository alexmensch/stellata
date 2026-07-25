# Util

Project-agnostic plumbing. Each topic owns a subfolder; the parent
also hosts `astronomy-constants.ts`, the single source of truth for
physical / astronomical constants shared across the client runtime,
build scripts, tests, and shader uniforms.

- `astronomy-constants.ts` — `AU_PER_PC` / `AU_PC` / `AU_KM` / `KM_PC` /
  `R_SUN_PC` / `SUN_ABSMAG_V` / `MIN_PHYSICAL_RADIUS_R_SUN` / `ARCSEC_TO_RAD` /
  `J2000_JD` / `J2000_OBLIQUITY_RAD` / `DAYS_PER_JULIAN_YEAR`. Import from here
  rather than re-derive — drift between sites is the failure mode this module
  is designed to prevent.
- `equatorial-basis.ts` — the ICRS tangent basis every sky-frame
  projection resolves against: `equatorialTangentBasisRad` (core) /
  `equatorialTangentBasis` (degrees) / `equatorialTangentBasisAt(x, y, z)`
  (from an equatorial Cartesian position, `null` at the origin) return
  `{u, east, north}` with east = ∂u/∂α / cos δ — never divided by cos δ,
  so it stays a unit vector through the poles. `unitVectorFromRaDec` is
  the `u` component alone. Shared by the catalog build's PM propagation +
  space-motion velocity (`scripts/catalog/direction-cascade.ts`), the
  companion tangent-projection (`scripts/catalog/companion-promotion.ts`),
  and the runtime Tier-1 sky→ICRS orbit projection
  (`../binaries/binary-orbit-pure.ts`). `scripts/local-group/`'s
  `skyBasis` deliberately does NOT ride this: it seeds a rotation
  quaternion and picks a canonical orientation at the pole, which this
  helper leaves to the caller's ra.
- `kepler-solver.ts` — `solveKepler(M, e)` + `wrapAngle(a)` Newton
  solver shared between Sol's planet ephemerides (e ≲ 0.25) and binary
  orbits (e up to ~0.95). 50-iter, 1e-12 tolerance defaults.
- `orbit-line.ts` — shared bits of the line overlays
  (`solar-system/ephemerides/orbit-rings-layer.ts`, `binaries/binary-orbit-path-layer.ts`,
  `constellation-figure/constellation-figure-layer.ts`): the alpha-blended
  primitives `makeOrbitLineLoop` / `makeOrbitLineSegments` +
  `makeOrbitLineMaterial(color, opacity?)` (default `ORBIT_LINE_OPACITY`) and
  the on-screen-size helpers `pixelsPerRadian` (+ `pixelsPerRadianFromFovRad`
  for callers holding the FOV in radians) / `angularRadiusPx` the orbit
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
- `pending-click.ts` — single/double-click disambiguator (hold a
  click for the double window, fire single on expiry). Drives canvas
  clicks in both camera modes.
- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `sid-resolver/` — runtime SID → `{kind, localIndex}` resolution over
  attached artifacts (docs/sid.md § 8).
- `url-state/` — `?v=` URL wire format (v1/v2/v3) and the address-bar
  round-trip.
