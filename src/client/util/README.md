# Util

Project-agnostic plumbing. Each topic owns a subfolder; the parent
also hosts `astronomy-constants.ts`, the single source of truth for
physical / astronomical constants shared across the client runtime,
build scripts, tests, and shader uniforms.

- `astronomy-constants.ts` — `AU_PER_PC` / `AU_PC` / `AU_KM` / `KM_PC` /
  `R_SUN_PC` / `ARCSEC_TO_RAD` / `J2000_JD` / `DAYS_PER_JULIAN_YEAR`.
  Import from here rather than re-derive — drift between sites is the
  failure mode this module is designed to prevent.
- `event-bus/` — typed pub/sub used by `stellata.ts` for fan-out.
- `url-state/` — `?v=` URL wire format (v1/v2/v3) and the address-bar
  round-trip.
