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
  `LayerContribution` + `ContributionSkip`, `SceneLayer`,
  `SceneLayerRegistry`.
- `frame-frustum.ts` (+ test) — `FrameFrustum`, the view planes a gated
  layer's frustum test reads off `FrameCtx`, with the validity sentinel
  that throws on a read above the frame's last camera write
  (§ Declaring what a layer can put on screen).
- `emitter-material.ts` — `EmitterMaterial` (§ The material seam).
  Type-only.
- `scene-layer.test.ts` — fan-out order, optional-hook semantics, the
  contribution skip path, and the cadence reduction (§ Declaring how time
  moves a layer).
- `frame-ctx-mock.ts` — `makeFrameCtx`, the neutral per-frame fixture
  (camera at Sol, clock zero, no warp, the acceptance plate scale, a
  frustum already refreshed from the camera) every layer / kind-module
  suite builds its `update` or `skip` call from, overriding the one field
  under test; plus `makeCadenceCtx` and `ACCEPTANCE_PX_PER_RADIAN`, the
  still-camera one-second-step fixture and the plate scale every pinned
  cadence number is quoted against.
- `scene-elements.ts` — the declutter-cycle floor table + derivation
  (§ Detail-level declutter cycle).
- `scene-elements.test.ts` — exhaustiveness + cumulative-set pinning.
- `glsl-residents-pure.ts` (+ test) — `findGlslResidents`, the walk
  behind the shell's first-frame check that no raw-GLSL material reached
  the rendered scene (§ No GLSL material may reach a WebGPU boot).
- `render-order.ts` (+ test) — `DEPTH_MASK_RENDER_ORDER`, the one
  draw-order slot two subsystems both write into. The ladder it belongs
  to is `../README.md` § Full render stack.

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

## No GLSL material may reach a WebGPU boot

The shipped renderer draws the one scene every layer builds into
(`../webgpu/README.md` § One scene per boot), and a raw `ShaderMaterial`
in it fails WGSL pipeline creation — which discards the entire submit,
so the symptom is a black frame naming nothing, not one absent layer.
`findGlslResidents` walks the graph and returns a description per
offending material; the shell runs it once, on the first rendered frame,
and logs what it finds. Every layer is parented by then, since the roster
attach loop and `registerSceneLayers` both run in the constructor ahead
of `animate()`.

It keys on `isShaderMaterial` rather than on `isNodeMaterial`: three's
node materials never set the former, and built-ins the renderer converts
itself never set the latter, so the positive test is the one that admits
`LineBasicMaterial` while still catching hand-written GLSL.

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
entries — the moving-focal ride, orbit rings, binary orbits — first;
then the camera readers, planet mesh through to SVG projectors like the
HUD, which additionally need the camera-matrix refresh —
§ Camera writes, then camera reads). Kind-module layers
(`../kinds/README.md`) register first of all: the constructor's roster
attach loop runs before `registerSceneLayers`, so a module layer
updates ahead of every inline-wired entry — which is what keeps the
probe and planet fields' samples frame-fresh for the first inline
entry, the moving-focal ride. Each inline entry is a
closure over the shell's layer field, so a lazily-attached layer
(binaries) reads whatever is currently attached — `null` before
attach, the live instance after, with no re-registration.

`FrameCtx` (camera, worldOffset, float64 `distFromSol`, model-clock
`t`, `warpActive`, `pxPerRadian`, and the `frustum` — § Declaring what a
layer can put on screen) is computed once per frame and shared. Warp
gating lives inside each entry, not in a branched caller: reference
layers (galactic disc / grid, Local Group wireframe, HUD) hide
themselves while `ctx.warpActive`; light-emitting and physical layers
(Milky Way, LG emission, planets, binaries, clouds) keep updating —
the old duplicated warp/non-warp fan-out branches collapse into the
per-entry decision. This mirrors the hover subsystem's one-engine /
many-providers pattern (`../hover/README.md`).

Adding a layer = constructing it + one `register(...)` call. Hooks
are optional except `dispose`, `timeBehaviour` and `contribution`; a
layer that doesn't participate in a fan-out simply omits the hook (e.g.
the heliopause has no per-frame update — its visibility is event-driven,
and `chart-labels`
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

**Not every entry owns a layer.** Two inline entries own no GPU resources
at all (`dispose` is empty) and exist purely to sequence a camera write
that belongs to another owner: the **moving-focal ride**, which has to
land after the module layers' position writes; and the attitude
indicator's **orbit lock** (`Stellata.setOrbitFrameTick`,
`../attitude/orbit-frame/README.md` § The lock), which has to land after
both focal rides, since it reads a datum they produce and pivots about the
`controls.target` they move. The registry is the only place that expresses
"between these two", so a sequencing-only entry is the intended shape
rather than a smell — but it is the exception, and it is spelled out here
so the next one has to justify itself. The orbit lock declares `'static'`:
an entry that draws nothing must never ask the cadence for a frame, and
this one writes only on frames something else already scheduled.

**The generalisation, since a third will come:** a per-frame camera write
belongs in this registry, never on a bus event. `'frame'` fires after the
render, so a write there is a frame late; and the ordering that makes a
write correct is a claim about *other layers*, which only registration order
can state.

## Declaring what a layer can put on screen

`contribution` is the second **required** declaration, and a
discriminated union for the same reason as `timeBehaviour`: an omitted
hook would read as "always draws", which is the silent answer every
layer gave before the contract existed, and the failure it prevents is
paying a draw and a per-frame update for something that cannot reach a
single display pixel from this vantage (`docs/render-rules.md` § 2 is
the rule; this is its mechanism).

Two kinds:

- **`'always'`** — every frame. Sequencing-only entries, the camera
  writers, anything that writes uniforms or membership other layers
  read (the solar and star clusters), and every layer not yet adopted.
- **`'gated'`** — `skip(ctx)` returns a `ContributionSkip` reason or
  `null`, and `setContributing(on)` hides or shows the layer's own
  groups. Three reasons are admissible, all geometric:
  `'frustum'` (bounding volume outside `ctx.frustum`), `'legibility'`
  (projected extent under `isFeatureLegible` /
  `FEATURE_LEGIBILITY_MIN_PX`, via `ctx.pxPerRadian`), `'opacity'`
  (the layer's own authored, distance-faded opacity is zero).

**The registry owns the skip; the layer owns its groups.** `updateAll`
runs `skip` before `update` and, on a skip, calls neither `update` nor
the draw — three skips a hidden group for free. `setContributing` fires
on the **transition only**, so a layer that stays skipped pays one
predicate call per frame. `recenter`, `setMonochrome` and `dispose` still
reach a skipped layer; `update`, the draw and both per-frame
`timeBehaviour` polls are elided (§ A skipped layer reports nothing).
Detail-permit and warp gating stay inside `update` — contribution is a
layer above them,
and a skipped layer never evaluates its permit. Per-layer state seeds
`contributing = true`, so a layer that draws from its first frame keeps
its constructed visibility and is never told anything.

**A layer that skips must reset every dirty-track sentinel on the way
out** (`docs/authoring-patterns.md` § Sentinel-init) inside
`setContributing(false)` — a "same as last frame" short-circuit computed
before the skip is exactly what refuses to repaint on re-entry.
`FresnelShell.permitted` starting `false` to agree with its constructed
`group.visible` is the worked example (`../fresnel-shell/README.md`
§ Invariants).

**The frustum is valid only below the orbit lock.** The focal rides and
the lock move the camera *inside* the fan-out, and the lock is a
rotation — so `FrameCtx.frustum` is invalidated every tick in
`refreshFrameCtx` and refreshed by the orbit-lock entry after its write
(§ Camera writes, then camera reads). A `'frustum'` test on an entry
registered above the lock throws on its first frame rather than culling
against a pose the frame does not render.

**Eight entries are above the lock, and which ones is not obvious from
reading `registerSceneLayers` alone.** All five kind-module layers —
molecular clouds, Local Group, the boundary shells, planets, probes —
register in the constructor's roster loop, which runs *before*
`registerSceneLayers` (§ How the shell uses it); the moving-focal ride,
the orbit rings and the binary orbits are the three inline entries ahead
of the lock. So clouds, the Local Group and the shells may gate on
legibility and opacity but **not** on frustum, and moving them below the
lock is not free: a module layer writes the positions the focal ride
reads, and the ride must precede the lock. Splitting one into a
position-write half and a draw-gate half is the only route, and it is
adoption's problem, not the contract's. `realtimeFramesNeeded` never
sees a valid frustum from any position — it runs above the gate, ahead
of every camera write in the frame.

`pxPerRadian` has no such constraint: it is a function of viewport and
FOV alone, hoisted above the gate, and `CadenceCtx.pxPerRadian` is a
copy of it.

### A skipped layer reports nothing

The two per-frame polls that read `timeBehaviour` — `cadenceReport` and
`realtimeFramesNeeded` — skip a non-contributing layer, so the fan-outs
a skipped layer still receives are `recenter`, `setMonochrome` and
`dispose` alone. Both have the same two reasons. Its `update` did not
run, so a rate it reported would be computed from the state of whichever
frame it last drew; and a layer that cannot put a pixel on screen cannot
move one, so it has no claim on the frame's redraw budget. Asking it
anyway would leave the layer scheduling frames for content it is not
drawing — the draw and the update saved, the frames not.

**This holds only while every admissible skip reason is a function of
camera pose.** Frustum, legibility and opacity all are, and camera
motion wakes the gate on its own, so a skipped layer is re-tested the
moment anything could change its verdict. A reason that is *not* a
function of pose — the deferred brightness test, whose input is the live
exposure — could fall skipped with the camera still and never be asked
again, because no `updateAll` would run to re-evaluate it. Admitting one
means giving it a wake path of its own; the design gate that admits it
owns that (stellata-8cg.50.4).

`cadenceReport` runs after `updateAll`, so it reads this frame's
verdicts. `realtimeFramesNeeded` runs above the gate and reads the last
rendered frame's — a layer stays presumed-skipped until a frame proves
otherwise, which is the conservative direction.

**The contract is per layer.** Per-instance culling inside a layer —
one cloud of ninety-six behind the camera — is `docs/render-rules.md`
§ 1's territory and lives in the layer's own `update`; the layer-level
verdict fires only when the whole population fails one test.

**No hysteresis, deliberately.** The three tests are geometric, so their
boundary is crossed only by camera motion, which already renders every
frame; a one-pixel pop at the six-pixel legibility floor is a
level-of-detail step, not a scheduling oscillation. The **brightness**
test — peak surface brightness under the display floor at the live
exposure — is *not* admissible under this contract: skipping an emitter
removes its share from the exposure statistic, which eases the cut,
which brings the emitter back, which deepens the cut. Its admission,
with the bound that closes that loop, is its own design gate
(stellata-8cg.50.4), and `FrameCtx` gains no exposure term until it
lands.

**Enforced two ways.** `tsc` refuses a layer without the declaration;
`../../../tests/cadence-layer-declarations.test.ts` scans the shipped
source for the always / gated census and pins that every registration
carries both declarations. `SceneLayerRegistry.contributionCensus()` is
the live audit surface — which layers are skipping right now and why —
printed by `debug.renderWatch()` (`../debug/render-watch/README.md`).

## Camera writes, then camera reads

The orbit lock is the frame's **last** camera write, and every entry that
reads the camera is registered below it. That split is the contract, not an
accident of where the lock happened to fit, and it is load-bearing in both
directions:

- A camera read above a write draws against a pose the frame does not
  render. For a projector (HUD arrows, distance vector, labels) that is a
  visible lag; for the **planet mesh** it is subtler and was the defect that
  established this section. `PlanetMeshLayer.update` caches
  `camera.matrixWorld` and transforms the host-star direction, the body's
  pole and every shadow caster into **view space** for its material
  uniforms, so a camera write after it leaves the lit terminator and the
  casters rotated against the surface by the write's own angle — the
  "swim" its own comment warns about. Under the orbit lock at scrub rate
  that angle is the datum's per-frame turn, degrees rather than
  hundredths.
- A camera *write* above a read is fine, so the writes go first: the two
  focal rides, then the lock.

**What the entries above the lock may rely on.** They read
`camera.position` only, for distance-based sizing and culling. The ride is
a rotation about `controls.target`, so it preserves the distance to the
**pivot** exactly — it does not preserve distance to anything else, and a
future above-the-lock entry that sizes off a distance to some *other* body
is relying on the chord of the ride angle being negligible. That is a claim
to check, not a given.

**A clean "all writes, then all reads" phase split is not reachable**, and
it is worth knowing why before anyone attempts one: the binary walk both
*reads* the camera (screen-size gating in `BinaryOrbitField.update`) and
*precedes* its own focal ride, which is a write. Separating the phases
means splitting that entry first.

Not in the registry: camera controllers, the star pipeline, and the
extinction prepass — they aren't scene layers and keep explicit
lifecycle calls in `stellata.ts`. `setMonochrome`'s star-pipeline
blend swap and renderer clear-colour also stay on the shell; the
registry carries the per-layer legs.
