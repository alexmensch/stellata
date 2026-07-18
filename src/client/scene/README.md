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
LG-emission `setEnabled`, orbit rings, binary links, heliopause shell,
Local Bubble shell) have no per-frame gate, so their bind *pushes* the
change imperatively. A per-element
override (`setSceneElementVisible`) writes one cache slot directly and
supersedes its floor until the next `applyDetailPreset` overwrites the
whole set.

**The preset is authoritative — overrides are within-scene only.** Three
elements also carry a legacy user toggle that ANDs with the floor:
`constellationFigures`←`showConstellation` (`C`), `milkyWayBand`/
`milkyWayIsobar`←`showMilkyway`, `lgEmissionGlow`←`showLgEmission`.
`applyDetailPreset` resets those toggles to `on` so a per-element hide
does **not** outlive a detail-level change — pick a new mode and the
scene's floors alone decide. A toggle can only *hide* a permitted element,
never force one below its floor. The chart↔realistic recompute passes
`resetOverrides:false`, so a style flip (and URL restore, which re-applies
the shared toggle state afterward) preserves the user's toggles.

Default `detailLevel = 'all'` (fully cluttered) → the seam is
behaviour-neutral at startup. `applyDetailPreset` runs on `V` / the
control / a decluttered `?v=` restore, **and on every chart↔realistic
flip** (`chart-mode.ts`) so the permitted set tracks the active style's
floor column. `USER_OWNED_IDS` enumerates the chrome the cycle never
writes (HUD, coord sphere, cards, feedback) — toggled by their own
affordances (`H` / `S` / `U` / `T`).

**Chart-content wiring.** The chart-only elements are read per-frame by
`chart-labels.ts`, which gates each label/glyph tier on
`detailPermits(id)`. Two couplings aren't one-to-one: planet name labels
ride `chartStarNameLabels` (no separate planet-label element — uadc.3
gave planets star-style labels), and `chartVariableRings` gates **both**
the variable rings and the binary wings (one row for the paired glyphs).
`milkyWayIsobar` has no per-frame reader — it *pushes* through its bind
(`setMilkywayIsobar` + `applyMilkywayEnabled`); the MW group is enabled
when either the band (realistic) or the isobar (chart) is permitted.

The chart column deliberately diverges from the general tier model: chart
mode has no true naked-eye tier, so its `physical` base is the *legible
chart* — `chartStarNameLabels` (hence planet names) and `chartBayerGlyphs`
sit at `physical`, not `representational`. `constellationFigures` enters
at `representational`, constellation Latin names (`chartConstellationNames`)
at `all`.

## How the shell uses it

`stellata.ts` registers one adapter entry per render layer in its
constructor, in draw-dependency order (the continuously-ticking trio —
orbit rings, planet bodies, binary orbits — first; SVG projectors like
the HUD after the camera-matrix refresh they need). Each entry is a
closure over the shell's layer field, so lazily-attached layers
(clouds, Local Group, binaries) read whatever is currently attached —
`null` before attach, the live instance after, with no re-registration.

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
update — its visibility is event-driven).

Not in the registry: camera controllers, the star pipeline, and the
extinction prepass — they aren't scene layers and keep explicit
lifecycle calls in `stellata.ts`. `setMonochrome`'s star-pipeline
blend swap and renderer clear-colour also stay on the shell; the
registry carries the per-layer legs.
