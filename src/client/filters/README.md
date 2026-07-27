# Filters

The filter / magnitude-preset / star-render-knob system: `FilterState`
and its canonical defaults, the three magnitude presets with their
angular-size calibration, the per-preset exaggeration-K table, the
star-disc render knobs, and the controller that owns every mutation.

## Files

- `filter-state.ts` — `FilterState`, `DEFAULT_FILTER`, `MagPresetName`,
  `MAG_PRESETS` (live binding — re-bound on every exaggeration-K
  change), `NAKED_EYE_LIMIT_MAG` (scalar for consumers that must not
  capture the live binding), `DEFAULT_FOV`, `ALL_SPECT_MASK`, `StarRenderParams`,
  `STAR_RENDER_DEFAULTS`, and the pure `presetPxSizes` arcsec→px
  conversion. Import filter types and preset constants from here, not
  from `stellata.ts`.
- `filter-controller.ts` — `FilterController`. Owns the single live
  `FilterState` instance and every mutation path: `setFilter`,
  `applyMagnitudePreset`, `recomputePresetPxSizes`, `setCameraFov`,
  `setStarExaggerationK`, `setStarRenderParams`, `clearSizeOverrides`,
  and the declutter cycle — `applyDetailPreset` /
  `setSceneElementVisible` drive the exhaustive scene-element binds
  (`../scene/README.md` § Detail-level declutter cycle). `FilterState`
  carries `detailLevel` (default `all`); the effective permitted set is a
  runtime cache on `Stellata`, not part of `FilterState`.
- `filter-controller.test.ts` — preset/override/clamp semantics against
  stub uniforms + camera.

## Seam — uniforms by reference, layers by hook

The controller writes the star-pipeline `sharedUniforms` subset
directly through the `FilterUniforms` refs it is constructed with
(the same pass-the-uniform-ref seam `MilkyWay` and `PlanetBodyField`
use), so a filter patch propagates to all three star passes with no
per-frame copying. Side effects on *other* layers (planet-field cull
distance, Milky Way / LG-emission enable) go through the shell's
`onFilterApplied` hook — layer identity stays in `stellata.ts`.

**`uExposure` is scene-wide, not star-local.** It arrives in the same map
from `HdrPipeline.emitterUniforms`, and `setFilter` derives it from
`maxAppMag` via `epochExposure` — so the magnitude slider is the single
tone-map exposure for every physical emitter, not just the star passes.
`../hdr/README.md` § Exposure epochs is the contract, including why the
write lives here rather than on `HdrPipeline`.

`setCameraFov` additionally drives `camera.updateProjectionMatrix()`,
mirrors `uFovYRad`, and calls the `refreshOrbitFloor` dep
(`FocusController.refreshOrbitFloor`) because the focused star's
manual-zoom floor depends on FOV.

Uniform seeding order: `stellata.ts` seeds the shared uniforms from
`DEFAULT_FILTER` at construction; the controller (constructed later,
after the layers its hook touches exist) starts from an identical
`{ ...DEFAULT_FILTER }` copy, so uniforms and state can't diverge
before the first `setFilter`.

## Behaviour contracts

- **Override flags.** `sizeMin/Max/Span` carry `*Overridden` flags:
  preset switches and viewport/FOV recomputes only write
  non-overridden fields; the reset buttons clear the flag AND restore
  the preset value via `clearSizeOverrides`.
- **Resize preserves manual magnitude.** `recomputePresetPxSizes`
  touches only sizeMin/Max — never `maxAppMag` / `sizeSpan` — and
  clamps `sizeMax >= sizeMin` after independent overrides.
- **Events.** Every mutation emits `'filter'` then `'state'` (the
  emission-pairing contract in `src/client/README.md` § Event bus).
  `setStarExaggerationK` emits even when the recompute patched nothing
  so the debug readout reflects the new K.
- **`MAG_PRESETS` is a live binding.** Consumers (`controls.ts`,
  `url-state.ts`) read current values after a K tweak without
  re-importing; don't capture it into a local at module load.

For the perception model behind the presets (PSF width, √Δm sizing,
soft-knee saturation) see `../star-pipeline/README.md` § Magnitude
presets and `docs/science-stellar-modelling.md`.
