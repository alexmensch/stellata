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

## The contract

**Exhaustiveness is the load-bearing contract** (same shape as
`FocusableProviders`): `SCENE_ELEMENT_FLOORS` is a mapped type over the
closed `SceneElementId` union — a new renderable that skips a floor row
fails `tsc`, pinned by `scene-elements.test.ts`. The runtime binds in
`stellata.ts` (`buildSceneElementBinds`) are a second exhaustive `Record`,
so an unwired element also fails `tsc`.

**Push meets pull at `Stellata.detailPermitted`.** `FilterController.
applyDetailPreset(level)` computes each element's floor permission and
calls its bind, which writes the `detailPermitted` cache. Per-frame
layers *pull* — their update / label predicate reads
`stellata.detailPermits(id)`. The few event-driven layers (Milky Way /
LG-emission `setEnabled`, orbit rings, binary orbit rings, heliopause
shell, Local Bubble shell) have no per-frame gate, so their bind *pushes*
the change imperatively. A per-element
override (`setSceneElementVisible`) writes one cache slot directly and
supersedes its floor until the next `applyDetailPreset` overwrites the
whole set.

**The preset is authoritative — overrides are within-scene only.** Exactly
one element still carries a legacy user toggle that ANDs with the floor:
`lgEmissionGlow`←`showLgEmission`. `applyDetailPreset` resets it to `on` so
a per-element hide does **not** outlive a detail-level change — pick a new
mode and the scene's floors alone decide. A toggle can only *hide* a
permitted element, never force one below its floor. The chart↔realistic
recompute passes `resetOverrides:false`, so a style flip (and URL restore,
which re-applies the shared toggle state afterward) preserves it.

The other three toggles are retired, and the floors are now the *only*
gate on their elements: `constellationFigures` /
`constellationBoundaries` (was `showConstellation`) and `milkyWayBand` /
`milkyWayIsobar` (was `showMilkyway`). Both were a second answer to a
question the declutter cycle already answered.

Default `detailLevel = 'all'` (fully cluttered) → the seam is
behaviour-neutral at startup. `applyDetailPreset` runs on `V` / the
control / a decluttered `?v=` restore, **and on every chart↔realistic
flip** (`chart-mode.ts`) so the permitted set tracks the active style's
floor column. `USER_OWNED_IDS` enumerates the chrome the cycle never
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
(`constellationBoundaries`, the one chart-only element that is WebGL
geometry rather than a `chart-labels` tier) at `all`.
