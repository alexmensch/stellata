# Filters

The filter / instrument / star-render-knob system: `FilterState` and its
canonical defaults, the instrument record and the limiting magnitude
derived from its aperture, the plate-scale-derived exaggeration K, the
star-disc render knobs, and the controller that owns every mutation.

## Files

- `filter-state.ts` — `FilterState`, `DEFAULT_FILTER`, `InstrumentName`,
  `INSTRUMENTS`, `limitMagForAperture` / `instrumentLimitMag` /
  `limitMagOf` / `sizeSpanOf`, `DEFAULT_FOV` (the instrument's own
  default), `TARGET_PX`, `STAR_PHYSICS_FACTOR`, `ALL_SPECT_MASK`,
  `StarRenderParams`, `STAR_RENDER_DEFAULTS`, the star-K multiplier module
  state, and the pure `arcsecPerPx` / `starExaggerationK` / `starPxSizes`
  plate-scale chain. Import filter types and instrument constants from
  here, not from `stellata.ts`.
- `filter-controller.ts` — `FilterController`. Owns the single live
  `FilterState` instance and every mutation path: `setFilter`,
  `setInstrument`, `recomputeStarPxSizes`, `setCameraFov`,
  `setStarKMultiplier`, `setStarRenderParams`,
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
and the three axes a future instrument needs.

**`skyBackgroundMagArcsec2` is the extended-source threshold surface
brightness**, read through `extendedThresholdSbFor` — the sibling of
`instrumentLimitMag`, and here rather than in `hdr/` for the same reason
that one is: an extended source is detected as a contrast against the sky
it sits in, so the background level *is* where its threshold sits
(`../hdr/emission/README.md` § Extended sources). Its only consumer is
`../hdr/exposure/exposure-epoch.ts` `summationSolidAngleFor`, which pairs
it with `m_lim`. It has yet to land as an additive floor on `L`, which is
the other half of the axis. `passband` still has no consumer.

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

### The multiplier is the ONLY footprint control, deliberately

"Star size Min / Max (px)" and "Dynamic range (mag)" are retired. Three
sliders shaped one thing — the display kernel's footprint — and after the
HDR seam moved brightness onto the emitted peak
(`../star-pipeline/README.md` § Physical-luminance emission), none of them
carried brightness any more. `sizeMin`/`sizeMax` were K's pixel projection
at the current viewport, so authoring them contradicted the `TARGET_PX`
invariant above; and "Dynamic range" was never display dynamic range but
the magnitude *window* of the footprint curve, colliding by name with the
tone-map's `DR_MAG`, which is the real lever (`../hdr/README.md`
§ Operator).

**The multiplier stayed where those two went, because it is
adaptation-neutral.** The exposure statistic divides a point source's flux
channel by the kernel's own area integral `Φ(n)·D²`
(`../hdr/statistic/README.md` § The unit), so moving K cannot move the
exposure cut — it buys legibility against how crowded a dense field looks
and nothing else. That is what makes it a safe taste axis to keep, and
`sizeMin`/`sizeMax` are now derived-only, with `recomputeStarPxSizes` as
their sole writer.

The footprint window is the instrument's `sizeSpan`, read through
`sizeSpanOf` on every use rather than cached on `FilterState`, so no second
authority for it can exist. `uSizeSpan` is now a **footprint uniform
only** — star quads and planet glare size through it. Its last
cross-layer consumer was the Local Group emission layer, which aliased
it as a pre-HDR brightness gate until that layer moved onto the physical
luminance unit (`../local-group/README.md` § Emission layer); nothing
outside the perceptual-footprint path reads it now, so a change to it
can no longer move a layer's brightness.

## Seam — uniforms by reference, layers by hook

The controller writes the star-pipeline `sharedUniforms` subset
directly through the `FilterUniforms` refs it is constructed with
(the same pass-the-uniform-ref seam `MilkyWay` and `PlanetBodyField`
use), so a filter patch propagates to all three star passes with no
per-frame copying. Side effects on *other* layers (planet-field cull
distance, LG-emission enable) go through the shell's `onFilterApplied`
hook — layer identity stays in `stellata.ts`. The Milky Way is no longer
one of them: its band is physical light gated by the declutter floor
alone, with no user toggle to AND against.

**The exposure scalar is NOT written here.** `ExposureController` owns
`uExposure` and the three magnitude bounds derived from the instrument
(`../hdr/exposure/README.md`); this controller's `setInstrument` hands the
instrument over and stops there. The write moved out when adaptation
arrived: exposure is no longer a function of filter state alone.

`setCameraFov` additionally drives `camera.updateProjectionMatrix()`,
mirrors `uFovYRad`, and calls the `refreshOrbitFloor` dep
(`FocusController.refreshOrbitFloor`) because the focused object's
manual-zoom floor is an angular solve for the star and planet kinds.
It also recomputes the star pixel sizes,
since K rides the plate scale.

Uniform seeding order: `stellata.ts` seeds the shared uniforms from
`DEFAULT_FILTER` at construction; the controller (constructed later,
after the layers its hook touches exist) starts from an identical
`{ ...DEFAULT_FILTER }` copy, so uniforms and state can't diverge
before the first `setFilter`.

## Behaviour contracts

- **No override flags.** There is no authoring path into `sizeMin/Max`, so
  instrument switches, viewport resizes and FOV changes all write both
  unconditionally. `starPxSizes` floors `sizeMax` at `sizeMin`, so the pair
  cannot invert and the controller needs no post-patch clamp. Since the
  plate scale divides by height, widening the window changes star size by
  zero.
- **Events.** Every mutation emits `'filter'` then `'state'` (the
  emission-pairing contract in `src/client/README.md` § Event bus).
  `recomputeStarPxSizes` always patches, so it always emits — which is why
  `setStarKMultiplier` and `setCameraFov` do NOT emit again after calling
  it.
- **The K multiplier is module state, not filter state.** It lives in
  `filter-state.ts` behind `getStarKMultiplier` / `setStarKMultiplier`
  because the pure size helpers read it; consumers call the getter rather
  than capturing a value at module load.
