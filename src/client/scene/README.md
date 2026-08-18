# Scene layer registry

The `SceneLayer` contract and `SceneLayerRegistry` — the seam that
keeps `stellata.ts` from hand-maintaining four parallel per-layer
enumerations (per-frame update fan-out, `setMonochrome`, floating-
origin `recenter`, `dispose`). One registration per layer covers all
four: a layer registered once cannot be silently missing from any of
them, which is the property the old copy-everywhere lists couldn't
guarantee.

## Files

- `scene-layer.ts` — `FrameCtx`, `SceneLayer`, `SceneLayerRegistry`.
- `scene-layer.test.ts` — fan-out order + optional-hook semantics.
- `frame-ctx-mock.ts` — `makeFrameCtx`, the neutral per-frame fixture
  (camera at Sol, clock zero, no warp) every layer / kind-module suite
  builds its `update` call from, overriding the one field under test.
- `scene-elements.ts` — the declutter-cycle floor table + derivation
  (§ Detail-level declutter cycle).
- `scene-elements.test.ts` — exhaustiveness + cumulative-set pinning.

## Detail-level declutter cycle

`scene-elements.ts` owns the **declutter cycle** (`V` key + the settings
3-stop control). `DetailLevel` = `physical | representational | all`,
cumulative, cycled *within* the current render style (`realistic` /
`chart`). `SCENE_ELEMENT_FLOORS` is the one exhaustive record — one row
per renderable, a `Floor` per style — so `permitted = floorPermits(floor,
level)`. Effective visibility is always `permitted AND` the layer's own
instance gates (focus / apparent-magnitude / warp), which are unchanged.

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
writes (HUD, both coordinate spheres, cards, feedback) — toggled by their
own affordances (`H` / `S` / `U` / `T`).

**Chart-content wiring.** The chart-only elements are read per-frame by
`chart-labels.ts`, which gates each label/glyph tier on
`detailPermits(id)`. Two couplings aren't one-to-one: planet name labels
ride `chartStarNameLabels` (no separate planet-label element — uadc.3
gave planets star-style labels), and `chartVariableRings` gates **both**
the variable rings and the binary wings (one row for the paired glyphs).
`milkyWayIsobar` has no per-frame reader — it *pushes* through its bind
(`MilkyWay.setIsobar` + `applyMilkywayEnabled`); the MW group is enabled
when either the band (realistic) or the isobar (chart) is permitted.

**What `physical` means in the realistic column:** the naked-eye scene —
what an unaided eye at the camera position would actually see. The test
is angular size and brightness at the camera, not "is the object real".
A deep-space probe is a real object whose marker sits at
`representational` for exactly this reason: a metre-scale spacecraft
subtends nothing at any range in the model, so its glyph represents the
object rather than showing it (`../solar-system/probes/README.md`
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

## How the shell uses it

`stellata.ts` registers one adapter entry per render layer in its
constructor, in draw-dependency order (the continuously-ticking
entries — the moving-focal ride + planet mesh, orbit rings, binary
orbits — first; SVG projectors like the HUD after the camera-matrix
refresh they need). Kind-module layers
(`../kinds/README.md`) register first of all: the constructor's roster
attach loop runs before `registerSceneLayers`, so a module layer
updates ahead of every inline-wired entry — which is what keeps the
probe and planet fields' samples frame-fresh for the first inline
entry, the moving-focal ride (whose post-ride camera the planet mesh
update then reads). Each inline entry is a
closure over the shell's layer field, so a lazily-attached layer
(binaries) reads whatever is currently attached — `null` before
attach, the live instance after, with no re-registration.

`FrameCtx` (camera, worldOffset, float64 `distFromSol`, model-clock
`t`, `warpActive`) is computed once per frame and shared. Warp
gating lives inside each entry, not in a branched caller: reference
layers (galactic disc / grid, Local Group wireframe, HUD) hide
themselves while `ctx.warpActive`; light-emitting and physical layers
(Milky Way, LG emission, planets, binaries, clouds) keep updating —
the old duplicated warp/non-warp fan-out branches collapse into the
per-entry decision. This mirrors the hover subsystem's one-engine /
many-providers pattern (`../hover/README.md`).

Adding a layer = constructing it + one `register(...)` call. Hooks
are optional except `dispose`; a layer that doesn't participate in a
fan-out simply omits the hook (e.g. the heliopause has no per-frame
update — its visibility is event-driven, and `chart-labels` registers
`dispose` alone because its per-frame work rides the `'frame'` event
under `chart-mode.ts`'s start/stop gate).

**Not every entry owns a layer.** The first inline entry owns no GPU
resources at all (`dispose` is empty): it exists to sequence the
moving-focal ride between the module layers' position writes and the
planet mesh's camera read, both of which belong to other owners. The
registry is the only place that expresses "between these two", so a
sequencing-only entry is the intended shape rather than a smell — but
it is the exception, and it is spelled out here so the next one has to
justify itself.

Not in the registry: camera controllers, the star pipeline, and the
extinction prepass — they aren't scene layers and keep explicit
lifecycle calls in `stellata.ts`. `setMonochrome`'s star-pipeline
blend swap and renderer clear-colour also stay on the shell; the
registry carries the per-layer legs.
