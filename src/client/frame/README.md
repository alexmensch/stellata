# Frame services

Kind-agnostic engine services for the renderer's floating local frame
(`docs/architecture-modularity.md` § Tier 1): the shared view/screen
uniform map every render pass holds by reference.

## Files in this area

```
src/client/frame/
  shared-uniforms.ts (+ test)     buildSharedUniforms — the one uniform
                                  map all three star passes (and the
                                  planet body field + Milky Way pass)
                                  share by reference. The test pins
                                  seeding + the perceptual-disc slot
                                  identities the planet pipeline picks
                                  out.
```

## Shared uniforms

`buildSharedUniforms` (`shared-uniforms.ts`) returns the one uniform
map the star disc, glow, and core-mask passes spread into their
materials — `uRenderMode` is the only divergent slot, bound per
material by `StarPipeline`. Every other consumer picks slots out of the
same object **by reference**, so a single write reaches all of them
with no bookkeeping: `FilterController` (the filter / instrument /
render knobs), `PlanetBodyField` (via `pickPerceptualDiscUniforms` +
`pickChartDiscUniforms`), `MilkyWay` (`uLimitMag`, for its chart-mode
isobar contour only — the band's own brightness is photometric),
`StarLocalMirror`, `ExtinctionPrepass`, `StarFrame` (`uFovYRad` /
`uViewport` for its windows), `DustParticleLayer`, `Picker`, and every
kind module through `KindContext.sharedUniforms`. The three
renderer-derived seeds (pixel ratio, FOV, viewport) are arguments; the
rest come from `DEFAULT_FILTER` / `STAR_RENDER_DEFAULTS` and the star
pipeline's own constants.

`uSizeSpan` is the exception to "comes from `DEFAULT_FILTER`": the
footprint window is no longer a `FilterState` field, so it seeds
through `sizeSpanOf(DEFAULT_FILTER)` — the instrument record is its
only authority (`../filters/README.md` § The multiplier is the ONLY
footprint control).

The one set of slots this map does **not** own is
`HdrPipeline.emitterUniforms` — `uExposure`, `uOmegaPxArcsec2`,
`uWhitePoint`, `uHighlightDesat`, `uHdrTarget` — passed in as the `hdr`
option and spread in by reference. `HdrPipeline` rewrites `uHdrTarget`
on every seam / resolve / chart-mode change, so copying the values
instead of sharing the objects would leave the star passes tone-mapping
inline into an already-tone-mapped target. Pinned in the test; see
`../hdr/README.md` § Unit.

Many slots are star-specific (`uColorLut`, `uLocalMemberIdx`,
`uPinFocusToCenter`, …) — the map is the union of what its consumers
read, and narrowing per consumer happens at the type level
(`PerceptualDiscUniforms`, `DustParticleSharedUniforms`,
`StarPhysicsUniforms`), not by cloning slots.
