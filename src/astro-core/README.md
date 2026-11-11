# astro-core

Shared physics: constants, angles, coordinate frames, orbits and the
photometric models both the build pipeline (`scripts/`) and the viewer
(`src/client/`) compute with. Neither side owns it; both import it.

**It imports nothing outside itself** but npm packages — no `scripts/`, no
`src/client/`, no `src/catalog-format/`. That is what lets a constant or a
frame have one definition the catalogue build and the shader uniforms both
read, and what lets the tree lift into its own workspace package unchanged.

## Subfolders

Each has its own README.

- `colour/` — the B–V → Teff → linear-sRGB blackbody chain.
- `emission/` — the luminance unit every emitter writes: magnitude →
  luminance, the point-source peak, the two solid angles, the population
  colours and the ρ₀ solve.
- `extinction/` — the CPU mirror of the per-star dust march.
- `iau-geometry/` — the IAU constellation boundaries at B1875: edges,
  cells, nearest-edge distance, label anchors.
- `milkyway/` — the band's column model and its photometric calibration.
- `tonemap/` — the display operator's CPU mirror and exact inverse.

## Files

- `equinoctial-pure.ts` (+ test) — the non-singular equinoctial element
  representation and the classical round trip; the Horizons element fetch
  and the viewer's planet ephemeris both express their elements in it
  ([Equinoctial elements](/src/client/solar-system/ephemerides/README.md#equinoctial-elements)).
- `angles.ts` (+ test) — `wrapAngle(a)` / `wrapDegrees(d)`, the signed
  wraps onto (−π, π] and (−180, 180]. Both reduce by one `floor`, not by
  a while-loop: Earth's spin accumulates ~6.6e8 degrees at the model
  clock's bounds and a loop would iterate millions of times to bring that
  back. Also `angleBetweenRad`, the unsigned angle between two
  unnormalised vectors as `atan2(|a×b|, a·b)` — **the small-angle-safe
  form, and the reason it is not `phaseAngleFromLegs`**: the cosine is
  flat near zero, so at 1e-6 rad the normalised dot rounds to 1 and
  `acos` returns exactly 0. Its callers (the render cadence's measured
  on-screen displacement, a moon's separation from the parent disc that
  hides it) work in that regime; a phase angle, read in degrees across a
  half-turn, does not.
- `astronomy-constants.ts` (+ test) — `AU_PER_PC` / `AU_PC` / `AU_KM` /
  `KM_PC` / `R_SUN_PC` / `SUN_ABSMAG_V` / `MIN_PHYSICAL_RADIUS_R_SUN` /
  `DEG_TO_RAD` / `RAD_TO_DEG` / `ARCSEC_PER_DEG` / `ARCSEC_TO_RAD` / `MAS_TO_RAD` / `J2000_JD` / `J2000_OBLIQUITY_RAD` /
  `HIPPARCOS_EPOCH_JYEAR` / `DAYS_PER_JULIAN_YEAR` / `SECONDS_PER_DAY` / `KM_S_PER_AU_YR` / `LIGHT_TIME_PER_AU_S` /
  `RA_HOURS_TO_DEG`.
  Canonical values, one definition each, so client / build-script /
  shader consumers can't drift on precision — import from here rather
  than re-derive. `RA_HOURS_TO_DEG` is the hours→degrees factor every
  catalogue RA column and sexagesimal boundary coordinate goes through;
  tests import it rather than restating 15.
  <a id="sun-absmag-v"></a>`SUN_ABSMAG_V` = 4.83 departs from the 4.81 (Vega) of
  [Willmer 2018](/data/papers/index.md#willmer2018) Table 3, and nothing records where 4.83 comes
  from: which value to adopt is an open decision (stellata-uadc.69.21, under
  the stellata-uadc.69 epic).
- `equatorial-basis.ts` (+ test) — the ICRS tangent basis every sky-frame
  projection resolves against: `equatorialTangentBasisRad` (core) /
  `equatorialTangentBasis` (degrees) / `equatorialTangentBasisAt(x, y, z)`
  (from an equatorial Cartesian position, `null` at the origin) return
  `{u, east, north}` with east = ∂u/∂α / cos δ — never divided by cos δ,
  so it stays a unit vector through the poles. `unitVectorFromRaDec` is
  the `u` component alone and `raDecFromUnitVector` its inverse (ra
  wrapped to [0, 360)); `SkyPosition` is the `{raDeg, decDeg}` pair both
  sides speak. Shared by the catalog build's PM propagation
  (`scripts/catalog/distance/direction-cascade.ts`) and space-motion velocity
  (`scripts/catalog/distance/velocity.ts`), the
  companion tangent-projection (`scripts/catalog/companions/companion-promotion.ts`),
  and the runtime Tier-1 sky→ICRS orbit projection
  (`src/client/binaries/binary-orbit-pure.ts`). `scripts/local-group/`'s
  `skyBasis` deliberately does NOT ride this: it seeds a rotation
  quaternion and picks a canonical orientation at the pole, which this
  helper leaves to the caller's ra.
- `cloud-density-pure.ts` (+ test) — the molecular-cloud density
  profile: `plummerProfile` and the soft ellipsoid `cloudEnvelope`. The
  clouds build calibrates against it (`scripts/clouds/`) and the absorption
  march's CPU mirror evaluates it
  (`src/client/molecular-clouds/absorption/`).
- `galactic-coords.ts` — `GAL_TO_ICRS` (Matrix4) and `GALACTIC_CENTRE_PC`
  (Vector3 at R₀ = 8.122 kpc), built from the J2000 IAU galactic-pole and
  galactic-centre angles with explicit re-orthogonalisation, plus
  `ICRS_TO_GAL_M3` and `R0_PC`. The galactic disc outline
  ([Sky reference system](/src/client/galactic/README.md)), the Milky Way
  band model and the dust bakers all read these — keep the module minimal
  and stable.
- `kepler-solver.ts` (+ test) — `solveKepler(M, e)`, the Newton
  solver shared between Sol's planet ephemerides (e ≲ 0.25) and binary
  orbits (e up to ~0.95). 50-iter, 1e-12 tolerance defaults. Also the
  element↔state pair `orbitalStateToCartesian` and its inverse
  `cartesianToOrbitalElements` — the inverse is what lets a body
  positioned by a *series* rather than by elements still get an orbit
  ring that passes through it (the Moon; [Orbit rings](/src/client/solar-system/ephemerides/README.md#orbit-rings)).
  The inverse also returns the eccentric anomaly, which
  the ring layer anchors its first vertex on; it comes out of `r` and
  `r·v` directly rather than from a second Kepler solve.
- `perceptual-magnitude.ts` (+ test) — `distanceModulus`, the one spelling
  of `5·log10(d / 10 pc)`, and the pair built on it: `apparentMagnitude`
  (floored at 1e-30 pc for the focal star) and its inverse
  `absoluteMagnitude` (unfloored: the build derives absmag only away from
  the origin). Then the reflected-light model's CPU side, which reads the
  host's irradiance at a body as `apparentMagnitude` at the host→body
  distance: a body's disc surface brightness and `planetApparentMagnitude`,
  plus `SOFT_TAPER_MARGIN_MAG`, the visibility taper every star and glare
  pass shares. The formula, its GPU mirror and the full-Moon anchor:
  [Reflected-light magnitude model](/src/client/solar-system/README.md#reflected-light-magnitude-model).
- <a id="precessionts"></a>`precession.ts` (+ test) — ICRS/J2000 ↔ the mean equator and equinox
  of another epoch, in **two models with different validity windows**:
  - **IAU 1976 ([Lieske 1979](/data/papers/index.md#lieske1979))** — `precessionAnglesFromJ2000`, the rotation
    they compose (`precessionRotationFromJ2000`), and its forward /
    inverse application to a direction or a `SkyPosition`.
    `besselianEpochToJd` supplies `B1875_JD`, the equinox the IAU
    constellation boundaries are drawn at — the θ sign and the epoch are
    both silent-failure modes, documented in
    [B1875](/src/astro-core/iau-geometry/README.md#b1875). Cubic
    polynomials: right for the 125 years back to B1875, arcminutes off at
    the model clock's bounds. `besselianEpochToJd`'s Julian sibling,
    `jdOfJulianYear`, and its inverse `julianYearOfJd` are the one spelling
    of a Julian epoch year as a JD and back.
  - **[Vondrák 2011](/data/papers/index.md#vondrak2011)** — `longTermEclipticPole` /
    `longTermEquatorPole` / `longTermEquinox` and the two frames they
    build (`longTermEclipticRotationFromJ2000`,
    `longTermEquatorRotationFromJ2000`), valid ±200 kyr. This is the one
    the model clock's span needs: the lunar theory's equinox-of-date
    frame and Earth's own pole both read it.

  The two coexist deliberately and are pinned against each other inside
  the overlap (they agree to 0.15″ near the present, 0.37″ at B1875).
  Don't replace the [Lieske 1979](/data/papers/index.md#lieske1979) path with the long-term one to "DRY them up" —
  the boundary geometry is pinned to arcsecond edge cases at B1875.
  [Vondrák 2011](/data/papers/index.md#vondrak2011) carries its own obliquity constant (84381.406″, IAU 2006) for
  the same reason: it is part of the published series, not a duplicate of
  `J2000_OBLIQUITY_RAD`.

## Instruments — an instrument is one physical number

`instruments.ts` — `InstrumentName`, `INSTRUMENTS`, `DEFAULT_INSTRUMENT`,
`limitMagForAperture` / `instrumentLimitMag` / `extendedThresholdSbFor`, and
`summationSolidAngleFor` with its default-instrument value
`DEFAULT_SUMMATION_ARCSEC2`. The viewer's filter state names an instrument;
the dust prefilter pins its froxel geometry to the default one's summation
area, which is why the record is shared.

```
{ apertureMm, defaultFovDeg, skyBackgroundMagArcsec2, passband }
   → m_lim = limitMagForAperture(apertureMm)
```

The unaided eye is `apertureMm` 7 — the dark-adapted pupil the 30″ PSF is
derived at — giving **`m_lim` 7.8**, a Bortle-1 best case in vacuum for a
fully night-adapted observer. `m_lim` is **derived, never authored**:
specifying an aperture gain *and* a magnitude limit states the same fact
twice, which is what the retired preset table did.

**There is no apparent-magnitude filter, by design.** "Show me fainter
stars" is a request for a larger aperture — a different instrument — so a
magnitude control would be a second, contradictory answer to the same
question. [§ 3.4](/docs/science-hdr-pipeline.md#34-the-instrument-record--aperture-is-the-single-number) carries the record shape
and the three axes a future instrument needs.

**`skyBackgroundMagArcsec2` is the extended-source threshold surface
brightness**, read through `extendedThresholdSbFor` — the sibling of
`instrumentLimitMag`, and on the instrument rather than in the exposure model for the same reason
that one is: an extended source is detected as a contrast against the sky
it sits in, so the background level *is* where its threshold sits
([Extended sources](emission/README.md#extended-sources--two-solid-angles-one-write-tail)). Its only consumer is
`summationSolidAngleFor`, which pairs it with `m_lim`. It has yet to land
as an additive floor on `L`, which is
the other half of the axis. `passband` still has no consumer.

## Baker constants

`baker-constants.json` is the one spelling of every fact the Python asset
bakers (dust, cloud surfaces, Local Bubble, textures) share with
TypeScript. Neither language owns a
copy: Python loads it through `scripts/util/baker_constants.py`
(`CONSTANTS`, a plain `json.load`); in TypeScript, `baker-constants.ts` is
the file's only importer. It holds next to the tree's other shared physics
because this tree imports nothing outside itself.

`baker-constants.ts` types the physics blocks and re-exports the raw file as
`BAKER_CONSTANTS`, which
[`baker-artifacts/`](/src/catalog-format/baker-artifacts/README.md) types the
artifact blocks from: versions, magic, encode ranges, file names.

Nothing here is frozen: a value changes by editing the file, after which
every reader agrees by construction. A value that is a property of one
artifact — a build parameter the client needs to read that artifact back —
travels in the artifact instead, written by its baker; this file holds what
both sides need *before* any artifact exists.

Adding a fact:

1. Add the key, camelCase, units in the name (`…Deg`, `…Km`, `…Pc`).
2. Export it under an explicit readonly type: a physics fact from
   `baker-constants.ts`, an artifact fact from `baker-artifacts.ts`.
3. Read it in Python from `CONSTANTS`. A Python entry point puts the repo
   root on `sys.path` so `scripts.util` imports.
4. Delete the old copies on both sides in the same commit.
5. A bake's `data/stamps/` record counts the file as read once the bake
   loads it; a Python builder with an mtime gate of its own lists
   `CONSTANTS_PATH` among the gate's inputs.

| Key | What | TS readers | Python readers |
|---|---|---|---|
| `galacticFrame` | J2000 IAU galactic centre and north pole, ICRS degrees | `galactic-coords.ts` | none: the dust bake reads the rotation it needs from `zucker-profiled.json` |
| `cloudModel` | `dustGridHalfExtentPc`, the dust voxel cube's half-extent | `DUST_GRID_HALF_EXTENT_PC`: the clouds build's in-grid test | `build-dust.py` |
| `artifacts` | File name, version and (for binaries) 4-byte magic of each artifact crossing the language line: `clouds`, `dustManifest`, `cloudSurfaces`, `localBubble`, and `zuckerProfiled` (written by `build:clouds`, read by the dust bake) | each artifact's loader, via `checkBinaryHeader` for the binaries | each artifact's writer; `trace_surfaces.py` also gates on the `clouds` version it reads |
| `planetShading` | Limb-darkening floor and exponent, and the terminator-softness floor, of the planet mesh shader | `planet-mesh-tsl.ts`, `mesh-surface-pure.ts` | `scripts/textures/measure_relief_lighting.py` |
| `surfaceRelief` | Horizon-map azimuth count and sine range, sky-view range, and per relief body its radius, albedo, colour-map centre longitude and DEM elevation span (Earth's floor is the sea surface: the DEM is clamped there) | `planet-system.ts`, `rotation-elements-pure.ts`, `surface-relief-pure.ts`, `planet-mesh-layer.ts`, `planet-mesh-tsl.ts` | `dem_relief.py` (merged into `DEM_BODIES`), `horizon_map.py`, `sky_view.py`, `measure_relief_lighting.py` |
| `ringSpans` | Uranus's and Neptune's ring annuli, km | `planet-system.ts` `rings` | `build-textures.py` `RING_TABLES` |
| `extinction` | `avPerEzgr`, A_V per unit Edenhofer dust density; `avPerNhPc`, A_V per pc per n_H cm⁻³ ([§ 2](/docs/science-molecular-clouds.md#2-extinction-physics-and-the-units-chain)) | cloud absorption graph, Milky Way column, shared-uniforms seed, the clouds build's calibration | `build-dust.py` (which writes `avPerEzgr` into the dust manifest) |
