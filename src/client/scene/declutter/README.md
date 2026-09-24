# Detail-level declutter cycle

`scene-elements.ts` owns the **declutter cycle** (`V` key + the settings
3-stop control). `DetailLevel` = `physical | representational | all`,
cumulative, cycled *within* the current render style (`realistic` /
`chart`). `SCENE_ELEMENT_FLOORS` is the one exhaustive record — one row
per renderable, a `Floor` per style — so `permitted = floorPermits(floor,
level)`. Effective visibility is always `permitted AND` the layer's own
instance gates (focus / apparent-magnitude / warp), which are unchanged.

The registry this sits beside (`../README.md`) decides per frame whether
a layer can reach the display at all; the declutter floor is a gate
*inside* a layer's `update`, one level below that verdict, and a skipped
layer never evaluates its permit.

## Files

- `scene-elements.ts` — the floor table + the pure floor→visibility
  derivation (`floorPermits`, `elementPermitted`, `visibleSet`),
  `DETAIL_LEVELS` / `DETAIL_RANK`, and `USER_OWNED_IDS`.
- `scene-elements.test.ts` — exhaustiveness + cumulative-set pinning.
- `scene-declutter.ts` — `SceneDeclutter`, the live permission cache
  (`stellata.declutter`) and every write into it.
- `scene-declutter.test.ts` — floor application, push order, and the two
  coupled enables.

## The contract

**Exhaustiveness is the load-bearing contract** (same shape as
`FocusableProviders`): `SCENE_ELEMENT_FLOORS` is a mapped type over the
closed `SceneElementId` union — a new renderable that skips a floor row
fails `tsc`, pinned by `scene-elements.test.ts`. That table is the one
place an element is classified; whether it is pulled or pushed is decided
by its layer, not by a second list.

**Push meets pull at `SceneDeclutter`.** `FilterController.
applyDetailPreset(level)` owns the level and the style and hands both to
`applyFloors`, which writes each element's floor permission through
`setPermitted`. Per-frame layers *pull* — their update / label predicate
reads `stellata.declutter.permits(id)` (a kind module reads it through
`KindContext.detailPermits`). The event-driven layers have no per-frame
gate, so `setPermitted` *pushes* the change: the shell's `layerPushes`
(orbit rings, binary orbit rings, constellation figure, the Milky Way
isobar), then the kind modules' `detailBinds()` (probe markers and trails,
both boundary shells). Two enables combine a permission with another
input and are derived here, not pushed: the Milky Way group is enabled
while `milkyWayBand || milkyWayIsobar`, LG emission while
`lgEmissionGlow && showLgEmission`; `refreshEnables` re-derives both after
a filter patch. A per-element override (`setSceneElementVisible`) writes
one slot and supersedes its floor until the next `applyDetailPreset`
overwrites the whole set.

**The preset is authoritative — overrides are within-scene only.** Exactly
one element still carries a legacy user toggle that ANDs with the floor:
`lgEmissionGlow`←`showLgEmission`. `applyDetailPreset` resets it to `on` so
a per-element hide does **not** outlive a detail-level change — pick a new
mode and the scene's floors alone decide. A toggle can only *hide* a
permitted element, never force one below its floor. The chart↔realistic
recompute is `reapplyDetailFloors()` — the current level, the new style's
floors, the toggle kept — so a style flip (and URL restore, which
re-applies the shared toggle state afterward) preserves it.

The floors are the *only* gate on every other element, including
`constellationFigures` / `constellationBoundaries` and `milkyWayBand` /
`milkyWayIsobar`: a user toggle there would be a second answer to a
question the declutter cycle already answers.

Default `detailLevel = 'all'` (fully cluttered) → the seam is
behaviour-neutral at startup. `applyDetailPreset` runs on `V` / the
control / a decluttered `?v=` restore; `reapplyDetailFloors` runs at the
end of construction (the seed push-only layers need) **and on every
chart↔realistic flip** (`chart-mode.ts`), so the permitted set tracks the
active style's floor column. `USER_OWNED_IDS` enumerates the chrome the cycle never
writes (HUD, all three coordinate spheres, cards, feedback) — toggled by
their own affordances (`H` / `S` / `U` / `T`).

## Chart-content wiring

The chart-only elements are read per-frame by
`chart-labels.ts`, which gates each label/glyph tier on
`detailPermits(id)`. Two couplings aren't one-to-one: planet name labels
ride `chartStarNameLabels` (no separate planet-label element — uadc.3
gave planets star-style labels), and `chartVariableRings` gates **both**
the variable rings and the binary wings (one row for the paired glyphs).
`milkyWayIsobar` has no per-frame reader — it *pushes* through its bind
(`MilkyWay.setIsobar` + `applyMilkywayEnabled`); the MW group is enabled
when either the band (realistic) or the isobar (chart) is permitted.

## What each tier means

**What `physical` means in the realistic column:** the naked-eye scene —
what an unaided eye at the camera position would actually see. The test
is angular size and brightness at the camera, not "is the object real".
A deep-space probe is a real object whose marker sits at
`representational` for exactly this reason: a metre-scale spacecraft
subtends nothing at any range in the model, so its glyph represents the
object rather than showing it (`../../solar-system/probes/README.md`
§ Declutter). Any future fixed-pixel glyph lands the same way.

The chart column deliberately diverges from the general tier model: chart
mode has no true naked-eye tier, so its `physical` base is the *legible
chart* — `chartStarNameLabels` (hence planet names) and `chartBayerGlyphs`
sit at `physical`, not `representational`. `constellationFigures`, the
molecular-cloud silhouette (`molecularCloudEllipsoids`), and cloud names
(`chartCloudNames`) enter together at `representational` — a cloud's name
never appears before its outline; constellation Latin names
(`chartConstellationNames`) and the IAU boundary arcs
(`constellationBoundaries`, the one chart-only element that is scene
geometry rather than a `chart-labels` tier) at `all`.
