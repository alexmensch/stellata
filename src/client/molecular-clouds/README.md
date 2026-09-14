# Molecular cloud layer

`molecular-clouds.ts` renders the ~96 named local SF clouds as two
decoupled components per cloud:

- **Absorption** — a per-fragment raymarch of the calibrated Zucker
  density model (`docs/science-molecular-clouds.md` §§ 4, 9) that dims every
  diffuse layer drawn behind the cloud (the MW band, LG emission).
  Physics, so it is **always on in realistic mode — never
  declutter-gated** — and hides only in chart mode. It has its own folder:
  `absorption/README.md`.
- **Rim shell** — the Local-Bubble fresnel-rim treatment
  (`../fresnel-shell/`) on a per-cloud **isosurface mesh** traced from
  the Edenhofer dust field (`cloud-surfaces.bin`; clouds without one
  fall back to their ellipsoid envelope), in the shared
  `SHELL_RIM_BLUE`. An orientation annotation, gated at the
  `representational` declutter floor (`molecularCloudEllipsoids`,
  `../scene/declutter/README.md`) — decluttering to `physical` leaves pure
  per-star extinction physics plus the absorption above. In chart mode
  it renders as a stippled silhouette outline (the SkyAtlas 2000 nebula
  convention) instead of a glow.

Both stay visible during warp by design (flying past Taurus is a
feature, not noise).

The module declares `contribution: { kind: 'gated' }` on
`anyCloudLegible` (`../scene/README.md` § Declaring what a layer can put
on screen): the whole layer skips once **no** cloud's silhouette clears
`FEATURE_LEGIBILITY_MIN_PX`, which from a few hundred parsecs out takes
the absorption raymarch and the rim pass with it. One cloud of ninety-six
behind the camera is per-instance culling instead, inside the draw
(`docs/render-rules.md` § 1). Being above the orbit lock, the layer may
not gate on the frustum at all — `../scene/README.md` § Declaring what a
layer can put on screen carries why. `setContributing(false)` clears
`rimGroup.visible` as well as the parent group, because the pick gate
reads that flag directly (§ The permit that gates the rim gates the pick).

`isAbsorptionDrawn` reads the parent group and the absorption group together
— the `cloudAbsorption` frame-cost lever's `present()`
(`../debug/frame-cost/passes/README.md` § The roster). Once the layer skips,
the raymarch is gone and `update` no longer runs, so the lever's kill switch
reaches nothing and its A/B would price zero.

The cloud kind module (`cloud-module.ts`) owns the runtime lifecycle:
its `load` fetches `public/clouds.json` via `cloud-loader.ts`
(version gate: v3; the client reads the geometry + density-model fields
+ the curated `aliases` and ignores the build-side `noiseModel` block) and
`public/cloud-surfaces.bin` via `cloud-surfaces-loader.ts` (sid-keyed
meshes; a missing artifact means every cloud uses its ellipsoid rim),
and its `attach` constructs the layer at the kind's roster position.
Each cloud carries a frozen Stellata ID (`sid`, docs/sid.md § 7); the
loader rejects the artifact (warn + null, same as a version mismatch)
when any sid is missing or duplicated — a pre-stamp `clouds.json` needs
`pnpm run build:clouds`. The resolver's `cloud` SID domain is the
module's `sids()` leg, attached by main.ts's roster loop (see
`../util/sid-resolver/README.md`).

## Files

- `cloud-module.ts` (+ test) — the cloud `ObjectKindModule`
  (`../kinds/README.md`): load/attach plus the focusable / card / hover
  (whose pick the click FSM shares) / search / SID / declutter legs and
  the live `renderedSizePx`, each reading the layer below.
- `molecular-clouds.ts` — `MolecularClouds` renderer + the silhouette /
  viewing-distance helpers.
- `cloud-loader.ts` — `clouds.json` v3 fetch/decode.
- `cloud-surfaces-loader.ts` — `cloud-surfaces.bin` fetch/decode
  (format: `scripts/cloud-surfaces/README.md`).
- `cloud-materials.ts` (+ test) — the material seam: the neutral
  `CloudMaterials` contract, the per-cloud `CloudAbsorptionSpec` both
  factories consume, and the WebGL2 implementation (§ The material seam).
- `absorption/` — the raymarch: its shader pair, `cloud-presence-pure.ts`
  and their own drift pin. `absorption/README.md`.
- `cloud-rim-pure.ts` — the rim shell's authored constants (stipple grid,
  contour width, alpha floor, `MIN_FWIDTH`), plus `CLOUD_RIM_EXTENT_PC` /
  `CLOUD_RIM_DISTANCES` (§ Rim shell render). GLSL cannot import, so its
  copies are pinned against this module.
- `cloud-glsl-drift.test.ts` — that rim pin, plus the output dither's seed
  offset and 8-bit divisor against `../hdr/tonemap/tonemap-pure.ts`, which
  owns them for every layer that dithers. The dither is asserted for **both**
  cloud shaders here rather than per folder, because it is one shape across
  the pair and the resolve. The noise itself is not copied at all — both
  shaders include the shared `stellata_ign` chunk (`../hdr/tonemap/README.md`
  § One hash). The absorption constants are pinned in `absorption/`.
- `cloud-pick-pure.ts` — the overlapping-cloud pick score + winner
  resolution (§ Picking + hover).
- `cloud-mock.ts` — `Cloud`/`CloudCatalog` test fixture builders.
- `cloud-rim.frag.glsl` — the rim/outline fragment stage; the vertex
  stage is the shared `../fresnel-shell/fresnel-shell.vert.glsl`.
- `cloud-labels.ts` — per-cloud silhouette-hugging SVG name labels
  (§ Labels).

## The material seam

Both surfaces are built through a `CloudMaterials` factory rather than
inline `ShaderMaterial`s, so a WebGPU boot swaps shaders without a second
copy of any cloud logic — per-cloud transforms, declutter and chart
gating, picking, labels and focus geometry all stay as they were. The
WebGPU twin is `../webgpu/molecular-clouds/README.md`; `cloud-module.ts`
passes `kindCtx.webgpu?.cloudMaterials` and adds the group to
`(webgpu?.scene ?? scene)`.

The layer hands each factory a `CloudAbsorptionSpec` rather than a
`Cloud`: it already owns the brick texture's lifetime (`brickTextures` is
what disposes it), and the tier — traced brick versus analytic Plummer —
is a **compile-time** choice on both backends, a `USE_FIELD` define on one
and two builder branches on the other. So the spec's values are seeded at
construction rather than written over neutral defaults; a material built
for the wrong `uUEnv` marches the wrong envelope from its first frame and
no later write would fix it.

One absorption material per cloud, one rim material for all of them —
unchanged from the WebGL layout.

## Absorption render

Its own folder now: `absorption/README.md` — the march and both tiers, the
`BackSide` and GLSL3 invariants, the fragment budget, the render-order
contract and the `location = 2` attachment write, and which clouds may dim
the band. `cloud-materials.ts` here still builds the material and owns the
brick texture's lifetime (§ The material seam).

## Rim shell render

One shared `ShaderMaterial` across all clouds (`FrontSide`,
`depthWrite: false`). Geometry is the traced isosurface mesh when
`cloud-surfaces.bin` carries the cloud's sid — absolute ICRS pc
positions with outward winding baked by the build, normals computed at
runtime — else the shared unit sphere scaled to `axes × uEnv` (the
density envelope, where the absorption ends). FrontSide + outward
winding is the fresnel-shell **hide-when-inside** contract: the shell
back-face-culls with the camera inside the cloud, while the BackSide
absorption keeps working from inside.

- **Realistic:** additive fresnel rim (`stellata_fresnel_rim` chunk) at
  the exact Local Bubble params (`SHELL_RIM_ALPHA_LIMB` + the shared
  face-on-floor / fresnel-power defaults — one annotation vocabulary),
  ±0.5-LSB dither.
- **Chart:** the material swaps to `NormalBlending` ink and the shader
  emits a stippled silhouette contour — an fwidth-scaled band where
  n·v → 0, masked by a screen-space dot grid.

The realistic arm also carries the shared camera-distance attenuation
(`../fresnel-shell/README.md` § Camera-distance attenuation), so a rim
fades out as the camera closes on it and a distant cloud reads dimmer than
a near one on the same scale as the Local Bubble wall. The chart arm
returns before the shared chunk, which is what keeps the stipple outline
free of it — a distance-varying ink density would break the flat
printed-atlas convention. `CLOUD_RIM_DISTANCES` carries both reaches for
every cloud — 12 pc near-fade, 170 pc depth reference. One material serves
all ~96, so both come off one representative radius
(`CLOUD_RIM_EXTENT_PC`, 20 pc) rather than per-cloud, which also means no
two clouds can disagree on the depth scale. Both halves of that shared
reach carry an accepted trade, and the near-fade's is the cloud-specific
one — `../fresnel-shell/README.md` § Camera-distance attenuation states
both.

## Labels

`cloud-labels.ts` mints one SVG `<text>` per cloud into `#cloud-labels`
and wires each through the shared shell-label engine
(`createShellSilhouetteLabel` — identical placement to the Local Bubble
and heliopause labels: silhouette support point + bottom-right offset +
chase lerp, near-plane bail hides the label with the camera inside, and
the engine's occlusion gate hides one whose support point sits behind a
planet, moon or resolved star disc — `../occlusion/README.md`, the fix
for a 150 pc cloud name drawn over a body 5 AU away).
Samples come from `labelSampleCount` / `labelSampleInto` on the layer —
a stride subsample of the traced mesh's vertices, or a fibonacci sweep
of the `u = uEnv` envelope for fallback clouds. A `labels`-tier
declutter element (`molecularCloudLabels`, floor `all`, realistic only —
chart names ride `chart-labels.ts`), additionally gated on the cloud's
projected silhouette reaching ~40 px (the module's `renderedSizePx` leg,
passed in) so distant complexes don't stack a label per member. The
module keeps the mount's teardown and runs it from its scene layer's
`dispose`.

## Constellation — centroid only, deliberately

The focus card's `Constellation` row answers for the cloud's **centroid**
(`../focus-card/README.md` § Constellation row), which is the convention
for naming one — Taurus Molecular Cloud, Aquila Rift, Coalsack in Crux.

It is also an under-answer, and knowingly so: a complex genuinely spans
several constellations, and the literature says so in prose ("spans
Taurus and Perseus"). The faithful version is the set of regions the
**isosurface** overlaps, not a point lookup — the traced mesh is the
input, not `centerAbs` — so it is its own piece of work rather than a
tweak to the row. Do not "fix" it by sampling the ellipsoid axes: the
fallback envelope is not the shape, and an axis-endpoint sample set would
report a different span from the mesh for the same cloud.

## Unified focus / measurement / warp UX

Clouds are full participants in the click-state machine alongside
stars. Internal state is the two `Target` slots on `FocusController`
(focus and vector destination, each a `{kind, idx}` sum type — cross-
kind mutual exclusion is structural). The click
handler dispatches by what was picked under the cursor — a cloud pick
from a star focus sets a star→cloud measurement vector; a cloud pick
from a cloud focus sets a cloud→cloud vector; clicking the current
vector tip (star or cloud) triggers a focus-park lerp via `focusStar`
or `flyTo`; pressing W or clicking the distance label dispatches to
`warpTo` with whatever Target the vector slot holds. The two
cloud-specific carve-outs are (a) no focus ring (the SVG overlay reads
`getFocusedStar` only and naturally ignores `focusedCloud`) and (b) the
park-distance inputs use the layer's `viewingDistancePc` (= `2.4 ×`
the effective extent, with a 5 pc floor) as the cloud's `dMinFloor`
instead of the star 90 %-fill solve.

**Effective focus geometry.** Fly-to / orbit / warp / labels / the
distance vector all aim at the layer's per-cloud **effective centre**
— the traced mesh's vertex centroid (with its max vertex radius as the
extent) — never at the Zucker bbox centroid, which can sit far from
the actual dust (Orion λ's traced knot is well off its ring-shaped
bbox centre). Fallback clouds keep the ellipsoid centroid with extent
`max(axes) × uEnv`. The absorption meshes stay anchored at the Zucker
centroid — the calibrated density model is defined in that frame.

## Picking + hover

Picking raycasts the **rim-shell meshes** — the depicted shape (traced
isosurface, or the `u = uEnv` ellipsoid for fallback clouds), the same
geometry behind the fresnel rim and the chart stipple outline — so the
hitbox matches the silhouette in both modes rather than the far-larger
absorption ellipsoid (its `SphereGeometry` is only the raymarch domain).
Chart mode keeps picking: the stipple outline is that same mesh drawing
a different material. Clicks and hovers run the same pick through the
kind roster, so a cloud competes against every other kind on size rather
than being reachable only when nothing else was hit; hovering a cloud's
body shows its name + distance + axes in the existing tooltip element.

**One winner resolver, in the layer.** `MolecularClouds.pick` is the
single entry point behind the module's one pick surface — the click
FSM (via `Picker.pickKindHit('cloud', …)`) and the hover engine run
the same function, so the two can never disagree on which of two
overlapping clouds the cursor is on. A tiebreak living in the click
handler instead would drift the moment either surface changes. (The
old click-side warp gate is subsumed by the FSM's `blocksClick()`.)
Resolving here first cannot disagree with the ordering across layers,
because both run the same comparison and the smallest of the smallest is
the smallest (`../hover/README.md` Rule 3).

**The permit that gates the rim gates the pick.** `pick` returns null
whenever `rimGroup.visible` is false, so below the `representational`
floor a cloud is neither hoverable nor clickable. Three raycasts hidden
objects, so without that read the layer answered the cursor from states
where it painted nothing — parked at the Moon, black sky raised a cloud
card. The rim/outline is the only mark this layer paints for itself:
absorption is physics and stays on in realistic mode, but it merely
attenuates light the star field and the band put down, so it is never
the hover affordance (`../hover/README.md` Rule 2). Deliberate
consequence, not an oversight: at the `physical` floor a cloud whose
absorption still visibly dims a rich background is unhoverable — that
dark lane is other layers' light minus what the cloud took, and the
cloud paints nothing there. The group starts hidden so the gate fails
closed until the first `update` states the permit.

**Tightest silhouette wins.** The raycast is *only* the hit-vs-miss gate
(every hit means the cursor is genuinely inside that cloud's outline).
Among the hits the winner is the one with the smallest projected radius,
and only between two of equal size does the lowest

    score = pxDistFromProjectedCentre / (renderedSizePx / 2)

decide — the cursor's offset from the cloud's projected centre as a
fraction of that cloud's *own* projected radius (0 = dead centre, 1 = at
the edge), via `cloud-pick-pure.ts`.

Both of the keys this replaced leave a cloud unreachable. Ray distance
("closest to camera wins", Three.js `intersectObjects` order) makes the
background cloud unreachable wherever a foreground one overlaps it.
Centrality alone fails the other way round: the cursor sits
proportionally deeper in a big complex near its centre than in a small
cloud near its rim, so the big one takes the small one's whole outer
half. Size is self-limiting instead — a small cloud takes exactly the
pixels it covers and no more.

This is the same comparison every other kind is ranked by, on the same
field, so a cloud and a shell and a star all order by size with nothing
kind-specific anywhere (`../hover/README.md` Rule 3).

Projection is against the **effective centre** (§ Effective focus
geometry), and the denominator is the layer's `renderedSizePx` — the
extent sphere for traced clouds, the tight ellipsoid quadric otherwise,
both at the depicted `u = uEnv` envelope, keyed off the canonical
shader-side pixels-per-radian (`KindContext.angularToPx()`, which reads
the shared view uniforms the star passes write) so the score matches the
silhouette the user actually clicked inside.
Every hit enters the shared `pickFromCandidates` reducer with `enclosed`
set, so the ray's verdict stands and `hitRadius` reports the silhouette's
size alone — see `cloudPickCandidate` for why deriving enclosure from
that radius instead would misclassify near-lobe hits.

## Search

Cloud entries enter the shared Fuse fuzzy index through the module's
`searchEntries()` leg, discriminated by their `kind` tag. Each cloud
indexes its canonical `name` plus every curated `aliases` entry
(`scripts/clouds/README.md` § Alternate names), all resolving to the
same cloud — the Local Group pattern. The Focus search box dispatches `flyTo` with the entry's Target
(focus-park lerp to viewing distance + set cloud focus); the To (distance
vector) box dispatches `setVector` the same way.

## Focus + warp entry points

Clouds ride the Target-keyed shell surface — no cloud-specific entry
points remain. Per-kind geometry (local position, park distance,
rendered silhouette) comes from the `cloud` FocusableProviders entry
(`../camera/focus/README.md` § FocusableProviders).

**`setOrbitTarget({kind:'cloud', idx})`:** the click-without-focus
path. Moves orbit pivot to the cloud centroid and sets the cloud
focus, but leaves the camera position unchanged. Displacing a star
focus doesn't snap the floating origin back to Sol, so the cloud's
absolute centroid is converted to local-frame coordinates by
subtracting `worldOffset` before assigning to `controls.target`.

**`flyTo({kind:'cloud', idx})`:** the focus-park path — used by
search-select and click-vector-tip. Mirrors `focusStar`: clears prior
focus + vector, then composes the generic `parkDistance(...)`
primitive with the cloud's effective extent as `R_pc` and the layer's
`viewingDistancePc(idx)` as `dMinFloor` (the provider's
`focusParkDistance` leg). Lerps over `FOCUS_LERP_MS` when the camera
is currently outside park, or stays put when inside. `animate: false`
(URL-restore) snaps. For animated travel between distant focal points
the user warps via the distance label.

**`warpTo({kind:'cloud', idx})`:** the cloud-destination warp. Source
point is whatever is focused (`currentFocusTarget()`); destination is
the cloud's effective centre; arrival offset is `viewingDistancePc`.
`WarpState` carries source/dest as kind-agnostic `FocusTarget`s
(`../camera/focus/README.md` § FocusTarget contract), so arrival parks
and focus dispatch need no per-kind switch.

## Floating-origin handling

Clouds live in absolute ICRS space; the group's `position` is rebased
to `-worldOffset` per frame, the same pattern as `GalacticDisc`. So
focusing on a far star (which shifts the floating origin to that star's
absolute position) doesn't move clouds visually — they stay anchored
where they should.

## URL state

Cloud focus and the cloud measurement vector ride in the shared `?v=`
blob (mutually exclusive with star focus and the star measurement vector
respectively). The old MC overlay disable flag at flags-byte bit 2
stays reserved and unencoded (`url-state.ts` `FLAG_*` block) — there
is no per-layer toggle; visibility is the declutter floor.

## Dev-console levers

Under `stellata.kinds.cloud.layer.*`:
- `setOpacity(x)` — master rim-glow gain (dark mode)
- `setColor(0xRRGGBB)` — override the shared rim blue
- `setRimParams({alphaLimb, faceOnFloor, fresnelPower, nearFadePc,
  depthDimRefPc, depthPower})` — rim shape plus camera-distance
  attenuation. Literally the same call as `stellata.kinds.shell`'s, over
  one record; the depth pair is one absolute scale spanning both kinds, so
  sweep it on both or the comparison it exists for says nothing
  (`../fresnel-shell/README.md` § Camera-distance attenuation)
- `setSteps(n)` — absorption raymarch step count
- `setAbsorptionEnabled(on)` — absorption-pass kill switch for
  frame-cost differentials (`../debug/frame-cost/README.md`);
  never a declutter gate
- `setMonoOpacity(x)` / `setMonoColor(0xRRGGBB)` — chart outline tuning
- `setDebugBoost(strength)` — boost the rim glow (or `null` to
  restore); use this first when "I can't see anything" to confirm the
  layer is rendering at all.
