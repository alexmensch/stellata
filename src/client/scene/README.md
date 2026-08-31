# Scene layer registry

The contracts a render layer is built and torn down through: `SceneLayer`
+ `SceneLayerRegistry` — the seam that keeps `stellata.ts` from
hand-maintaining four parallel per-layer enumerations (per-frame update
fan-out, `setMonochrome`, floating-origin `recenter`, `dispose`); and
`EmitterMaterial`, the material-level sibling (§ The material seam). One
registration per layer covers all four: a layer registered once cannot be
silently missing from any of them, which is the property the old
copy-everywhere lists couldn't guarantee.

**All four fan-outs run every layer even when one throws** — they go through
`../util/fan-out.ts`, which collects failures and rethrows them as a single
`AggregateError` once every layer has had its call. Registration guarantees a
layer is *reached*; this is what guarantees it is reached even when an
earlier layer is broken. Nothing is swallowed. The failure it removes: one
layer throwing inside `setMonochromeAll` left every later layer in the
opposite palette permanently, because the mode flag driving the swap had
already flipped, so re-entering the mode was a no-op (`stellata-59sg`).

## Files

- `scene-layer.ts` — `FrameCtx`, `CadenceCtx`, `LayerTimeBehaviour`,
  `SceneLayer`, `SceneLayerRegistry`.
- `emitter-material.ts` — `EmitterMaterial` (§ The material seam).
  Type-only.
- `scene-layer.test.ts` — fan-out order, optional-hook semantics, and the
  cadence reduction (§ Declaring how time moves a layer).
- `frame-ctx-mock.ts` — `makeFrameCtx`, the neutral per-frame fixture
  (camera at Sol, clock zero, no warp) every layer / kind-module suite
  builds its `update` call from, overriding the one field under test;
  plus `makeCadenceCtx` and `ACCEPTANCE_PX_PER_RADIAN`, the still-camera
  one-second-step fixture and the plate scale every pinned cadence number
  is quoted against.
- `scene-elements.ts` — the declutter-cycle floor table + derivation
  (§ Detail-level declutter cycle).
- `scene-elements.test.ts` — exhaustiveness + cumulative-set pinning.

## The material seam

`EmitterMaterial` pairs a `THREE.Material` with the uniform slots its
layer drives, and that indirection is what lets a layer cross shader
backends without a second copy of itself: a TSL `uniform()` node carries
`.value` exactly as an `IUniform` does, so `u.uFade.value = fade` reaches
either backend and no layer learns which one it has. `dispose()` goes
through the handle rather than the material because on WebGPU it must
also sever the material's MRT-mode registration.

It lives here, beside `SceneLayer`, because three subsystems now build
surfaces through it — the solar-system family
(`../solar-system/materials/README.md`), the boundary shells
(`../fresnel-shell/README.md`) and the dust sprite
(`../dust/README.md`). Each subsystem's own factory interface
(`SolarSystemMaterials`, `ShellMaterials`, `DustParticleMaterials`) stays
with the layer that owns it; only the surface handle is shared. The
`IUniform` face over a TSL node record is `uniformSlotsOf`
(`../webgpu/tsl/README.md` § Uniform slots).

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
writes (HUD, all three coordinate spheres, cards, feedback) — toggled by
their own affordances (`H` / `S` / `U` / `T`).

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
are optional except `dispose` and `timeBehaviour`; a layer that doesn't
participate in a fan-out simply omits the hook (e.g. the heliopause has
no per-frame update — its visibility is event-driven, and `chart-labels`
registers `dispose` alone because its per-frame work rides the `'frame'`
event under `chart-mode.ts`'s start/stop gate).

## Declaring how time moves a layer

`timeBehaviour` is **required**, and a discriminated union rather than an
optional hook, because the failure it prevents is **silence**: an omitted
hook reads as "nothing I draw moves", and a layer that does move then
freezes between the render gate's cadence frames — the worst failure mode
arrived at by doing nothing. A new layer cannot compile without
answering, and every answer is a claim reviewable on its own terms.

Three kinds:

- **`'static'`** — nothing this layer draws changes as either clock
  advances. It still repaints on an explicit `invalidate(reason)`; this
  is a claim about TIME, not about being immutable. Fixed geometry
  (galactic disc, coordinate spheres, the Milky Way skybox, the B1875
  boundary arcs), pure projection (the HUD), and teardown-only entries.
- **`'clock'`** — content moves as SIM time advances. `rate(ctx)` reports
  how fast, per sim second, for what the layer is drawing right now;
  `../render-gate/cadence/README.md` owns the whole contract and the
  reason the pixel ratio is deliberately absent from `CadenceCtx`.
- **`'realtime'`** — animates on WALL-CLOCK time, so it needs real frames
  even with the sim clock paused, which no sim-time rate can express.
  **This kind defeats idling for as long as its predicate holds**, so it
  is a last resort. Prefer converging over a count of RENDERED frames
  instead: an N-frame blend looks the same at 60 Hz and at one frame per
  30 s, and declares `'static'`.

**There are ZERO `'realtime'` layers, and that is enforced.** The type
can only check the layers that exist when it is written, and the live
registry needs WebGL to build, so
`../../../tests/cadence-layer-declarations.test.ts` scans the shipped
source: it pins the realtime count at zero, pins the static/clock split,
and pins that every inline `register({…})` in the shell carries a
declaration. The invariant used to be asserted in three READMEs and
enforced by nothing.

Its predicate is evaluated **above** the gate, every tick, which is why
`animate()` builds `FrameCtx` before the render decision rather than
after it — a layer that starts needing wall-clock frames while the gate
idles would otherwise wait a whole cap for one, and forever with the
clock paused, which fires no cadence frame at all.

### Anchored content declares its anchor's rate

Several entries draw views of ONE subsystem's content: a moon's orbit
ring is centred on the moon's parent, the star local cluster mirrors
slots the binary walk wrote, a constellation figure's vertex may BE a
binary member. Each declares the rate of the subsystem it is anchored to,
which is not a global min in disguise —
`../render-gate/cadence/README.md` § Anchored content carries the
`min(a, a) = a` argument and the per-frame memo that keeps the walk to
one pass.

**Not every entry owns a layer.** The first inline entry owns no GPU
resources at all (`dispose` is empty): it exists to sequence the
moving-focal ride between the module layers' position writes and the
planet mesh's camera read, both of which belong to other owners. The
registry is the only place that expresses "between these two", so a
sequencing-only entry is the intended shape rather than a smell — but
it is the exception, and it is spelled out here so the next one has to
justify itself.

There are **two**, and here is the second one's argument. The attitude
indicator's orbit lock writes the camera (`Stellata.setOrbitLockRide`,
`../attitude/orbit-frame/README.md` § The lock), and its slot is fixed from
both sides: after every moving field's position writes and after **both**
focal rides, since it reads a datum those produce and pivots about the
`controls.target` they move; and before every entry that projects the camera
to screen space, or the HUD arrows, the distance vector and the labels draw
against a pose the frame does not render. It therefore sits directly after
the binary-orbit entry, the later of the two rides. Entries above it are
indifferent by construction — the ride is a pure rotation about the target,
so it changes no distance, and each of them sizes or culls off distance.
It declares `'static'`: an entry that draws nothing must never ask the
cadence for a frame, and this one writes only on frames something else
already scheduled.

**The generalisation, since a third will come:** a per-frame camera write
belongs in this registry, never on a bus event. `'frame'` fires after the
render, so a write there is a frame late; and the ordering that makes a
write correct is a claim about *other layers*, which only registration order
can state.

Not in the registry: camera controllers, the star pipeline, and the
extinction prepass — they aren't scene layers and keep explicit
lifecycle calls in `stellata.ts`. `setMonochrome`'s star-pipeline
blend swap and renderer clear-colour also stay on the shell; the
registry carries the per-layer legs.
