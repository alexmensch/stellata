# Scene layer registry

The contracts a render layer is built and torn down through: `SceneLayer`
+ `SceneLayerRegistry` — the seam that keeps `stellata.ts` from
hand-maintaining four parallel per-layer enumerations (per-frame update
fan-out, `setMonochrome`, floating-origin `recenter`, `dispose`); and
`EmitterMaterial`, the material-level sibling ([The material seam](#the-material-seam)). One
registration per layer covers all four: a layer registered once cannot be
silently missing from any of them, which is the property the old
copy-everywhere lists couldn't guarantee. The ordering those layers
compose into — every draw slot, front to back, canvas and SVG — is
[Full render stack](#full-render-stack--front-to-back).

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
  `SceneLayerRegistry`, and `cameraAbsInto` — the frame's absolute ICRS
  camera position, which both diffuse emitters' peak providers key on.
- `emitter-material.ts` — `EmitterMaterial` ([The material seam](#the-material-seam)).
  Type-only.
- `emitter-material-mock.ts` — `fakeEmitterMaterial`, the double every
  layer suite's own factory fake is built from, `surfaceRecorder` (the
  mint-seed-keep body those fakes share), and `expectSlotsServedBy`.
  Its slot record answers any name, minting one on first touch, so a suite
  on it pins the layer's behaviour and never the uniform roster — that
  roster belongs to the factory, and the factory's own suite is where a
  missing slot fails. **Answering any name is also what a misspelled write
  rides through**, so the double records `touchedSlots` and a factory suite
  asserts every name its layer touched is one the shipped factory serves
  (`expectSlotsServedBy`). Worth adding wherever the layer's slot names and
  the factory's are written out separately; not where one shared function
  applies them to both, as `applyRimParams` does for the shells.
- `scene-layer.test.ts` — fan-out order, optional-hook semantics, the
  contribution skip path, and the cadence reduction ([Declaring how time
  moves a layer](#declaring-how-time-moves-a-layer)).
- `frame-ctx-mock.ts` — `makeFrameCtx`, the neutral per-frame fixture
  (camera at Sol, clock zero, no warp, the acceptance plate scale, a
  frustum already refreshed from the camera) every layer / kind-module
  suite builds its `update` or `skip` call from, overriding the one field
  under test; plus `makeFrameExposure` (the shipped instrument at zero cut
  with a statistic that measures it — override `statistic.meanL` for a
  cut), `makeCadenceCtx` and `ACCEPTANCE_PX_PER_RADIAN`, the still-camera
  one-second-step fixture and the plate scale every pinned cadence and
  brightness number is quoted against.
- `contribution/` — what a layer may put on screen: the two kinds, the
  four skip reasons, and the frustum module only they use. Own README.
- `declutter/` — the detail-level declutter cycle: the exhaustive
  scene-element floor table, its derivation and tests. Own README.
- `glsl-residents-pure.ts` (+ test) — `findGlslResidents`, the walk
  behind the shell's first-frame check that no raw-GLSL material reached
  the rendered scene ([No GLSL material may reach a WebGPU boot](#no-glsl-material-may-reach-a-webgpu-boot)).
- `render-order.ts` (+ test) — `DEPTH_MASK_RENDER_ORDER`, the one
  draw-order slot two subsystems both write into. The ladder it belongs
  to is [Full render stack](#full-render-stack--front-to-back) — front to back.

## The material seam

`EmitterMaterial` pairs a `THREE.Material` with the uniform slots its
layer drives, and that indirection keeps the graph out of the layer: a
TSL `uniform()` node carries `.value` exactly as an `IUniform` does, so
`u.uFade.value = fade` reaches the shader and no layer learns what built
it. `dispose()` goes
through the handle rather than the material because it must also sever
the material's MRT-mode registration.

It lives here, beside `SceneLayer`, because every material-building
subsystem takes its surfaces through it — the solar-system family
(`../solar-system/materials/README.md`), the Milky Way band, the
molecular clouds, the Local Group glow, the boundary shells
(`../fresnel-shell/README.md`) and the dust sprite (`../dust/README.md`).
Each subsystem's own factory interface (`SolarSystemMaterials`,
`BandMaterials`, `CloudMaterials`, `LgEmissionMaterials`, `ShellMaterials`,
`DustParticleMaterials`) stays
with the layer that owns it; only the surface handle is shared. The
`IUniform` face over a TSL node record is `uniformSlotsOf`
([Uniform slots](../webgpu/tsl/README.md#uniform-slots--the-face-a-layer-writes)).

## No GLSL material may reach a WebGPU boot

The shipped renderer draws the one scene every layer builds into
([One scene per boot](../webgpu/README.md#one-scene-per-boot)), and a raw `ShaderMaterial`
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

## How the shell uses it

`stellata.ts` registers one entry per render layer in its constructor.
A subsystem that owns its wiring builds its own entries
([Wiring](../solar-system/README.md#wiring)) and the shell only registers them,
since where each goes is a claim about *other* layers; the rest are inline
adapters. Registration is in draw-dependency order (the continuously-ticking
entries — the moving-focal ride, orbit rings, binary orbits — first;
then the camera readers, planet mesh through to SVG projectors like the
HUD, which additionally need the camera-matrix refresh —
[Camera writes, then camera reads](#camera-writes-then-camera-reads)). Kind-module layers
(`../kinds/README.md`) register first of all: the constructor's roster
attach loop runs before `registerSceneLayers`, so a module layer
updates ahead of every inline-wired entry — which is what keeps the
probe and planet fields' samples frame-fresh for the first inline
entry, the moving-focal ride. Each inline entry is a
closure over the shell's layer field, so a lazily-attached layer
(binaries) reads whatever is currently attached — `null` before
attach, the live instance after, with no re-registration.

`FrameCtx` (camera, worldOffset, float64 `distFromSol`, model-clock
`t`, `warpActive`, `pxPerRadian`, and the `frustum` — [Declaring what a
layer can put on screen](#declaring-what-a-layer-can-put-on-screen)) is computed once per frame and shared. Warp
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
registry needs a GPU renderer to build, so
`../../../tests/cadence-layer-declarations.test.ts` scans the shipped
source: it pins the realtime count at zero, pins the static/clock split,
and pins that every inline `register({…})` in the shell carries a
declaration.

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
[Anchored content](../render-gate/cadence/README.md#anchored-content) carries the
`min(a, a) = a` argument and the per-frame memo that keeps the walk to
one pass.

<a id="not-every-entry-owns-a-layer"></a>**Not every entry owns a layer.** Two inline entries own no GPU resources
at all (`dispose` is empty) and exist purely to sequence a camera write
that belongs to another owner: the **moving-focal ride**, which has to
land after the module layers' position writes; and the attitude
indicator's **orbit lock** (`Stellata.setOrbitFrameTick`,
[The lock](../attitude/orbit-frame/README.md#the-lock)), which has to land after
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
layer gave before the contract existed. The two kinds, the four
admissible skip reasons, which layers are gated and which refused, the
photometric reason and its wake path, and the frustum's
below-the-lock constraint are **`contribution/README.md`**.

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

## Full render stack — front to back

The full layer composition is something `stellata.ts` owns at the
integration shell — each subsystem renders into the same scene, and
which layer wins which pixel is the property that emerges here.
Each row links to the README that owns the layer's implementation.

Every canvas row below renders into the HDR target, not the canvas —
including the local depth pass, whose repaint lands in the same target.
One fullscreen tone-map then resolves the target to the canvas, so
nothing in the table composites against the canvas directly and the SVG
layer sees only the resolved frame ([hdr/](../hdr/README.md)). Chart mode
bypasses the target and renders straight to the canvas as before.

One pass draws after the resolve and appears nowhere in the table: the
exposure statistic's mip reduction, which binds its own targets, writes no
pixel the user sees, and is read back a frame later
([hdr/exposure/reduction/](../hdr/exposure/reduction/README.md)). Every row
below that emits physical light also writes the target's second,
statistic attachment ([hdr/attachments/](../hdr/attachments/README.md)); every
chrome row is gated out of it.

There is no z-ordering between the canvas and SVG. The canvas paints
first; the SVG `#overlay` always sits above it (`z-index: 5`,
`pointer-events: none`). **Every label surface therefore asks
[occlusion/](../occlusion/README.md) whether a nearer body hides its
anchor** — a CPU answer, because no depth verdict reaches a `<text>`
element. Without it a moon behind its planet keeps its label and a
150 pc cloud name draws over a body 5 AU away. Inside each layer the ordering is local:
the canvas orders by `THREE.Object3D.renderOrder`, SVG by source order in
`src/client/app/index.html` (later child = on top). The constellation
figure is depth-tested line geometry (`renderOrder −0.75`), so
close star and planet discs occlude it through the depth buffer — no
SVG mask (`../constellation-figure/README.md`).

| Layer                                            | Surface | Mechanism                                          | Order | Owner |
| ------------------------------------------------ | ------- | -------------------------------------------------- | :---: | ----- |
| Focus ring                                       | SVG     | source order (last child)                          | front | [overlays/](../overlays/README.md) |
| Click ripple                                     | SVG     | source order                                       |       | [overlays/](../overlays/README.md) |
| Heliopause label                                 | SVG     | source order                                       |       | [solar-system/heliopause/](../solar-system/heliopause/README.md) |
| Local Bubble label                               | SVG     | source order                                       |       | [local-bubble/](../local-bubble/README.md) |
| Molecular cloud labels                           | SVG     | source order                                       |       | [molecular-clouds/](../molecular-clouds/README.md) |
| Planet labels                                    | SVG     | source order                                       |       | [solar-system/planets/labels/](../solar-system/planets/labels/README.md) |
| Probe labels                                     | SVG     | source order                                       |       | [solar-system/probes/](../solar-system/probes/README.md) |
| POI labels                                       | SVG     | source order                                       |       | [overlays/](../overlays/README.md) |
| POI rings                                        | SVG     | source order                                       |       | [overlays/](../overlays/README.md) |
| POI arrows                                       | SVG     | source order                                       |       | [overlays/](../overlays/README.md) |
| Sol/GC arrow labels                              | SVG     | source order                                       |       | [galactic/](../galactic/README.md) |
| Distance label + warp pill                       | SVG     | source order                                       |       | [overlays/](../overlays/README.md), [camera/warp/](../camera/warp/README.md) |
| Distance vector + bg                             | SVG     | source order                                       |       | [overlays/](../overlays/README.md) |
| Sol/GC arrows + bg                               | SVG     | source order                                       |       | [galactic/](../galactic/README.md) |
| HUD ring                                         | SVG     | source order                                       |       | [galactic/](../galactic/README.md) |
| Chart labels + glyphs (chart only)               | SVG     | source order (three groups)                        |       | [chart-mode/labels/](../chart-mode/labels/README.md) |
| Coordinate-sphere edge labels                    | SVG     | source order (first SVG children)                  |       | [galactic/coord-spheres/](../galactic/coord-spheres/README.md) |
| *— SVG / canvas boundary —*                       | —       | `.overlay { z-index: 5 }`                          | —     | — |
| Planet glow mirror (cluster members)             | canvas  | local depth pass; bracket z-buffer (4 in-pass)     |       | [solar-system/planets/](../solar-system/planets/README.md), [local-depth/](../local-depth/README.md) |
| Member-star glow mirror                          | canvas  | local depth pass (3.5 in-pass)                     |       | [star-pipeline/local-pass/](../star-pipeline/local-pass/README.md), [local-depth/](../local-depth/README.md) |
| Probe marker mirror (cluster active)              | canvas  | local depth pass (3.3 in-pass)                     |       | [solar-system/probes/](../solar-system/probes/README.md), [local-depth/](../local-depth/README.md) |
| Probe trail mirror (cluster active)               | canvas  | local depth pass (3.25 in-pass)                    |       | [solar-system/probes/](../solar-system/probes/README.md), [local-depth/](../local-depth/README.md) |
| Orbit rings                                      | canvas  | local depth pass (3.2 in-pass)                     |       | [solar-system/ephemerides/](../solar-system/ephemerides/README.md), [local-depth/](../local-depth/README.md) |
| Binary orbit paths                               | canvas  | local depth pass (3.2 in-pass)                     |       | [binaries/orbit-paths/](../binaries/orbit-paths/README.md), [local-depth/](../local-depth/README.md) |
| Planet atmosphere shell (Venus/Earth/Mars/Titan) | canvas  | local depth pass; additive (2.82 in-pass)          |       | [solar-system/atmosphere/](../solar-system/atmosphere/README.md), [local-depth/](../local-depth/README.md) |
| Planet ring annulus (Saturn/Uranus/Neptune)      | canvas  | local depth pass; bracket z-buffer (2.81 in-pass)  |       | [solar-system/planets/](../solar-system/planets/README.md), [local-depth/](../local-depth/README.md) |
| Planet spheroid mesh (close LOD)                 | canvas  | local depth pass; bracket z-buffer (2.8 in-pass)   |       | [solar-system/planets/](../solar-system/planets/README.md), [local-depth/](../local-depth/README.md) |
| Member-star disc mirror                          | canvas  | local depth pass (0 in-pass)                       |       | [star-pipeline/local-pass/](../star-pipeline/local-pass/README.md), [local-depth/](../local-depth/README.md) |
| Member-star core mask (depth-only)               | canvas  | local depth pass (−1 in-pass, `colorWrite: false`) |       | [star-pipeline/local-pass/](../star-pipeline/local-pass/README.md), [local-depth/](../local-depth/README.md) |
| *— local depth pass boundary (depth cleared) —*  | —       | drawn after the whole main pass                    | —     | — |
| Planet glow (inactive-cluster hosts)             | canvas  | `renderOrder: 4`                                   |       | [solar-system/planets/](../solar-system/planets/README.md) |
| Probe markers (cluster inactive)                  | canvas  | `renderOrder: 3.5`                                 |       | [solar-system/probes/](../solar-system/probes/README.md) |
| Probe trails (cluster inactive)                   | canvas  | `renderOrder: 3.4`                                 |       | [solar-system/probes/](../solar-system/probes/README.md) |
| Dust particles                                   | canvas  | `renderOrder: 2`                                   |       | [dust/](../dust/README.md) |
| Star glow + heliopause shell                     | canvas  | `renderOrder: 1`                                   |       | [star-pipeline/](../star-pipeline/README.md), [solar-system/heliopause/](../solar-system/heliopause/README.md) |
| Star disc                                        | canvas  | `renderOrder: 0`                                   |       | [star-pipeline/](../star-pipeline/README.md) |
| Constellation figure                             | canvas  | `renderOrder: -0.75`                               |       | [constellation-figure/](../constellation-figure/README.md) |
| IAU constellation boundaries (chart only)        | canvas  | `renderOrder: -0.8`                                |       | [constellation-boundaries/](../constellation-boundaries/README.md) |
| Galactic disc + coordinate spheres               | canvas  | `renderOrder: -1`                                  |       | [galactic/](../galactic/README.md), [galactic/coord-spheres/](../galactic/coord-spheres/README.md), [local-group/](../local-group/README.md) |
| Local Bubble shell                               | canvas  | `renderOrder: -1`                                  |       | [local-bubble/](../local-bubble/README.md) |
| Molecular cloud rim shells                       | canvas  | `renderOrder: -1`                                  |       | [molecular-clouds/](../molecular-clouds/README.md) |
| Molecular cloud absorption                       | canvas  | `renderOrder: -2`                                  |       | [molecular-clouds/](../molecular-clouds/README.md) |
| Milky Way volume + Local Group emission          | canvas  | `renderOrder: -3`                                  |       | [milkyway/](../milkyway/README.md), [local-group/](../local-group/README.md) |
| Star core depth-mask (depth-only)                | canvas  | `renderOrder: -4`, `colorWrite: false`             |       | [star-pipeline/](../star-pipeline/README.md) |
| Planet depth pre-stamp (depth-only)              | canvas  | `renderOrder: -4`, `colorWrite: false`             | back  | [solar-system/planets/depth-stamp/](../solar-system/planets/depth-stamp/README.md) |

### Per-layer visibility gates and tuning

Each layer owns its own visibility gates, magnitude cutoffs, and
shader tuning in its README. Look there when investigating a
"layer-isn't-showing" or "wrong layer wins this pixel" report.

The two cross-layer pinning rules `stellata.ts` is responsible for:

- **The `-4` depth stamps** run first so background layers (MW,
  clouds, galactic grid — all with `depthTest: true`) depth-fail
  behind close-range bright star cores and opaque planet meshes instead
  of being shaded and then repainted. Two writers hold the slot: the
  star core mask, and the planet depth pre-stamp — a depth-only, shrunk
  copy of each opaque body mesh, since the mesh itself writes its depth
  in the local pass where the main pass cannot test against it
  (`../solar-system/planets/depth-stamp/README.md`). Two writers in two
  subsystems is why this is the one `renderOrder` in the table with a
  name of its own — `DEPTH_MASK_RENDER_ORDER` (`render-order.ts`);
  every other slot belongs to a single layer and is spelled where it is
  set. Moving it means moving both writers together, or this table stops
  being true.
- **The local depth pass owns the active system — and every resolved
  star disc.** While a system is locally active (host in cull range,
  or its orbit rings drawing), every one of its bodies — the host
  star included — collapses in the main pass via the sentinel
  uniforms (`uLocalMemberIdx`, `uLocalPassRange`) and renders through
  the pass's mirror draws instead, where a bracketed standard-depth
  z-buffer orders everything natively (ring↔body, moon↔planet,
  transits, near-side orbit-ring arcs). Star membership extends
  beyond the host: the focal binary chain (with its orbit-path
  ellipses) and any resolved-disc star near the camera mirror the
  same way (`../star-pipeline/local-pass/star-local-cluster.ts`). The
  `planet-body-field` test pins the pass renderOrders; a reorder
  fails CI rather than silently regressing.
  See [local-depth/](../local-depth/README.md).

Within the same `renderOrder` value, the opaque-before-transparent
rule of the three.js renderer determines order; opaque depth-write
meshes establish the depth buffer that transparent passes test
against.

Rows above the local-depth boundary render in a second, depth-cleared
pass *after* the whole main stack, ordered against each other by a
bracketed standard-depth z-buffer (the in-pass renderOrder only
sequences opaque-before-transparent) — see
[local-depth/](../local-depth/README.md). While the solar-system cluster
is inactive (camera beyond the cull range, or chart mode) its bodies
render through the ordinary main-pass planet/star rows instead.
