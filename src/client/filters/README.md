# Filters

The filter / instrument / star-render-knob system: `FilterState` and its
canonical defaults, the instrument record and the limiting magnitude
derived from its aperture, the plate-scale-derived exaggeration K, the
star-disc render knobs, and the controller that owns every mutation.

## Files

- `filter-state.ts` — `FilterState`, `DEFAULT_FILTER`, `InstrumentName`,
  `INSTRUMENTS`, `limitMagForAperture` / `instrumentLimitMag` /
  `limitMagOf`, `DEFAULT_FOV` (the instrument's own default), `TARGET_PX`,
  `STAR_PHYSICS_FACTOR`, `ALL_SPECT_MASK`, `StarRenderParams`,
  `STAR_RENDER_DEFAULTS`, the star-K multiplier module state, and the pure
  `arcsecPerPx` / `starExaggerationK` / `starPxSizes` plate-scale chain.
  Import filter types and instrument constants from here, not from
  `stellata.ts`.
- `filter-controller.ts` — `FilterController`. Owns the single live
  `FilterState` instance and every mutation path: `setFilter`,
  `setInstrument`, `recomputeStarPxSizes`, `setCameraFov`,
  `setStarKMultiplier`, `setStarRenderParams`, `clearSizeOverrides`,
  and the declutter cycle — `applyDetailPreset` /
  `setSceneElementVisible` drive the exhaustive scene-element binds
  (`../scene/README.md` § Detail-level declutter cycle). `FilterState`
  carries `detailLevel` (default `all`); the effective permitted set is a
  runtime cache on `Stellata`, not part of `FilterState`.
  `getStarExaggerationK` / `getArcsecPerPx` read the *derived* K and the
  plate scale it keys on at the live FOV and viewport —
  `getStarKMultiplier` is only that product's middle term, which is why
  the debug readout shows both.
- `filter-controller.test.ts` — instrument/override/clamp semantics
  against stub uniforms + camera.

## An instrument is one physical number

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
question. `docs/science-hdr-pipeline.md` § 3.4 carries the record shape
and the three axes a future instrument needs (`skyBackgroundMagArcsec2`
and `passband` are named there and have no consumer yet).

## Star pixel size is plate-scale-derived

```
arcsec_per_px = fov_deg · 3600 / viewport_height_css_px
K = kDensity · kMultiplier · max(1, TARGET_PX · arcsec_per_px / psfArcsec)
```

so a threshold star lands on `TARGET_PX` (2.592 px) identically — **star
pixel size is invariant in FOV and in viewport size** — until K floors at
1 and the true 30″ PSF takes over and the disc grows. The reference
dimension is viewport **height**, the axis a vertical FOV maps to and the
one `Ω_px` already uses; the old `max(w, h)` compromise is retired, not
re-tuned, because a coarser plate scale raises K on its own and a
threshold star still lands on target. Derivation:
`docs/science-stellar-modelling.md` § Stellar perception model;
`docs/science-hdr-pipeline.md` § 3.3 for why FOV must not buy depth.

The "Star size exaggeration" slider is a **multiplier** on that derived K
(1 = physical plate scale), not a per-instrument constant.

## Seam — uniforms by reference, layers by hook

The controller writes the star-pipeline `sharedUniforms` subset
directly through the `FilterUniforms` refs it is constructed with
(the same pass-the-uniform-ref seam `MilkyWay` and `PlanetBodyField`
use), so a filter patch propagates to all three star passes with no
per-frame copying. Side effects on *other* layers (planet-field cull
distance, Milky Way / LG-emission enable) go through the shell's
`onFilterApplied` hook — layer identity stays in `stellata.ts`.

**The exposure scalar is NOT written here.** `ExposureController` owns
`uExposure` and the three magnitude bounds derived from the instrument
(`../hdr/exposure/README.md`); this controller's `setInstrument` hands the
instrument over and stops there. The write moved out when adaptation
arrived: exposure is no longer a function of filter state alone.

`setCameraFov` additionally drives `camera.updateProjectionMatrix()`,
mirrors `uFovYRad`, and calls the `refreshOrbitFloor` dep
(`FocusController.refreshOrbitFloor`) because the focused star's
manual-zoom floor depends on FOV. It also recomputes the star pixel sizes,
since K rides the plate scale.

Uniform seeding order: `stellata.ts` seeds the shared uniforms from
`DEFAULT_FILTER` at construction; the controller (constructed later,
after the layers its hook touches exist) starts from an identical
`{ ...DEFAULT_FILTER }` copy, so uniforms and state can't diverge
before the first `setFilter`.

## Behaviour contracts

- **Override flags.** `sizeMin/Max/Span` carry `*Overridden` flags:
  instrument switches and viewport/FOV recomputes only write
  non-overridden fields; the reset buttons clear the flag AND restore
  the derived value via `clearSizeOverrides`.
- **Resize recomputes only the derived sizes.** `recomputeStarPxSizes`
  touches only sizeMin/Max — never `sizeSpan` — and clamps
  `sizeMax >= sizeMin` after independent overrides. Since the plate scale
  now divides by height, widening the window changes star size by zero.
- **Events.** Every mutation emits `'filter'` then `'state'` (the
  emission-pairing contract in `src/client/README.md` § Event bus).
  `setStarKMultiplier` emits even when the recompute patched nothing
  so the debug readout reflects the new K.
- **The K multiplier is module state, not filter state.** It lives in
  `filter-state.ts` behind `getStarKMultiplier` / `setStarKMultiplier`
  because the pure size helpers read it; consumers call the getter rather
  than capturing a value at module load.
