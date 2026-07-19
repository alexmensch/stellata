# Util

Project-agnostic plumbing. Each topic owns a subfolder; the parent
also hosts `astronomy-constants.ts`, the single source of truth for
physical / astronomical constants shared across the client runtime,
build scripts, tests, and shader uniforms.

- `astronomy-constants.ts` — `AU_PER_PC` / `AU_PC` / `AU_KM` / `KM_PC` /
  `R_SUN_PC` / `MIN_PHYSICAL_RADIUS_R_SUN` / `ARCSEC_TO_RAD` / `J2000_JD` /
  `DAYS_PER_JULIAN_YEAR`. Import from here rather than re-derive — drift
  between sites is the failure mode this module is designed to prevent.
- `kepler-solver.ts` — `solveKepler(M, e)` + `wrapAngle(a)` Newton
  solver shared between Sol's planet ephemerides (e ≲ 0.25) and binary
  orbits (e up to ~0.95). 50-iter, 1e-12 tolerance defaults.
- `orbit-line.ts` — shared bits of the orbital-geometry overlays
  (`solar-system/orbit-rings-layer.ts`, `binaries/binary-orbit-path-layer.ts`):
  the alpha-blended `LineLoop` primitive (`makeOrbitLineLoop` /
  `makeOrbitLineMaterial` + `ORBIT_LINE_SEGMENTS` / `ORBIT_LINE_OPACITY`)
  and the on-screen-size helpers `pixelsPerRadian` / `angularRadiusPx` both
  layers use for their pixel-size visibility gate.
- `pending-click.ts` — single/double-click disambiguator (hold a
  click for the double window, fire single on expiry). Drives canvas
  clicks in both camera modes.
- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `sid-resolver/` — runtime SID → `{kind, localIndex}` resolution over
  attached artifacts (docs/sid.md § 8).
- `url-state/` — `?v=` URL wire format (v1/v2/v3) and the address-bar
  round-trip.
