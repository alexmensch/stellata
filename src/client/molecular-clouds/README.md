# Molecular cloud layer

`molecular-clouds.ts` renders the ~96 named local SF clouds as two
decoupled components per cloud:

- **Absorption** — a per-fragment raymarch of the calibrated Zucker
  density model (`docs/science-molecular-clouds.md` §§ 4, 9) that dims every
  diffuse layer drawn behind the cloud (the MW band, LG emission).
  Physics, so it is **always on in realistic mode — never
  declutter-gated** — and hides only in chart mode.
- **Rim shell** — the Local-Bubble fresnel-rim treatment
  (`../fresnel-shell/`) on a per-cloud **isosurface mesh** traced from
  the Edenhofer dust field (`cloud-surfaces.bin`; clouds without one
  fall back to their ellipsoid envelope), in the shared
  `SHELL_RIM_BLUE`. An orientation annotation, gated at the
  `representational` declutter floor (`molecularCloudEllipsoids`,
  `../scene/README.md`) — decluttering to `physical` leaves pure
  per-star extinction physics plus the absorption above. In chart mode
  it renders as a stippled silhouette outline (the SkyAtlas 2000 nebula
  convention) instead of a glow.

Both stay visible during warp by design (flying past Taurus is a
feature, not noise).

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
- `cloud-presence-pure.ts` — CPU mirror of the absorption math (Plummer
  density, absorption alpha). Vitest-pinned.
- `cloud-pick-pure.ts` — the overlapping-cloud pick score + winner
  resolution (§ Picking + hover).
- `cloud-mock.ts` — `Cloud`/`CloudCatalog` test fixture builders.
- `cloud-absorption.vert.glsl`, `cloud-absorption.frag.glsl` — the
  absorption raymarch pair.
- `cloud-rim.frag.glsl` — the rim/outline fragment stage; the vertex
  stage is the shared `../fresnel-shell/fresnel-shell.vert.glsl`.
- `cloud-labels.ts` — per-cloud silhouette-hugging SVG name labels
  (§ Labels).

## Absorption render

Every cloud is one shared `SphereGeometry(1.03, 32, 16)` mesh scaled
per-instance to its semi-axes and rotated by its quaternion (the 3%
inflation covers tessellation sag; the shader clips to the analytic
envelope sphere). The fragment shader raymarches the ellipsoid segment
(4–14 jittered steps, screen-adaptive) and converts the A_V column to
`α = 1 − exp(−0.921·A_V)`, capped at 0.95. **Traced clouds march the
per-cloud Edenhofer density brick** (`USE_FIELD` define; a linear-u8
`Data3DTexture` from `cloud-surfaces.bin`, `A_V = 2.742·∫E dl`, clip
at the brick's u = 1.05 taper edge) — the same volume the rim
isosurface was traced from, so the shadow matches the silhouette 1:1
and the dimming matches per-star extinction physics. Fallback clouds
march the calibrated Plummer profile, clipped at the mass-budget
envelope `u = uEnv`. The draw is **alpha-only premultiplied over** (rgb = 0
under `premultipliedAlpha: true` + `NormalBlending`), i.e. the blend is
`background × (1 − absorption)` — nothing is added. Per § 9.1 the ray
start carries static IGN jitter (never reseeded per frame) and the
output carries ±0.5-LSB dither.

**Fragment budget.** The march is clipped to the envelope sphere
`u = uEnv` (density is identically zero outside it; a
mass-budget-tightened cloud like Orion λ at uEnv 0.22 discards ~95%
of its projected disc in one dot product), the step count adapts to
the chord's projected pixel extent (capped by the `uSteps` lever), and
the march breaks once the column saturates the alpha cap.

The material is `BackSide`: exactly one fragment per covered pixel
from outside and inside (the raymarch segment is analytic either way);
`FrontSide` would kill the inside-the-cloud absorption. The shaders
avoid the `#version 300 es` directive and don't redeclare
auto-injected attributes (`position`, `normal`, `modelMatrix`, etc.);
doing either silently breaks the GLSL3 compile.

**Render-order contract** (`docs/science-molecular-clouds.md` § 9.1 rule 5):
the absorption alpha dims only layers drawn *before* the absorption
meshes (`renderOrder −2`). Every diffuse background the clouds should
extinct — the MW band and LG emission (−3), any future HiPS /
sky-imagery layer — must render earlier; a layer added after the mesh
silently escapes extinction. Point sources are exempt (the per-star
raymarch owns their extinction; no double-count). The reference chrome
at −1 (galactic disc/grid, Local Bubble shell, the cloud rim shells
themselves) deliberately draws after the mesh — annotation shouldn't
be extincted.

**Order is necessary and no longer sufficient**, because the band and the
LG glow write the HDR target's *third* attachment now, not the one the
absorption draw would reach by default. The mesh is `markAbsorber`ed
(`../hdr/attachments/README.md` § The gate) and the shader writes its
alpha-only texel to `location = 2` as well as `location = 0`; one blend
equation covers both, so the multiply is identical on each. Drop either
half and the clouds keep drawing, keep sorting correctly, and extinct
nothing — no error, no missing draw, just no dark rift. The
`location = 2` write is what becomes **per-cloud conditional** once the band
reads the measured grid itself (§ below); `location = 0` is unaffected.

**Which clouds may dim the band is decided per cloud, not per layer**
(`docs/science-galactic-structure.md` § The dust stack). The band's dust
comes from the highest-resolution source covering each point, so a cloud
either supplies its own volume — and is carved out of the band's read of the
voxel grid — or is left to the grid, which already holds it. The test is
whether the cloud's own model out-resolves the grid *and* the grid resolves
the cloud across enough voxels to carry shape. Of 74 clouds inside grid
coverage that splits 52 / 22: the 22 are the 21 fallback ellipsoids plus
Cygnus X (brick 15.2 pc at 1163 pc, coarser than the grid it sits in), and
they stop dimming the band, which then shows their measured shape instead of
an authored ellipse. The 22 clouds beyond coverage always supply their own.
Until the band reads the grid this is contract, not code: today every cloud
dims the band and the overlap with the slab costs ~0.006 mag sky-mean.

A cloud's tier changes only its **absorption** role. Rim shells, chart
outlines, labels, picking and focus are annotation and never move.

Treating the clouds as a pure foreground *screen* is sound toward the
inner Galaxy — only 2.3 % of the GC column's emission originates inside
500 pc, so they really are in front of the light. It is weakest toward
the anticentre, where 65 % of that column is within 2.5 kpc and the
clouds sit *inside* the emitting volume. Second-order, because the
anticentre column is small.

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

## Labels

`cloud-labels.ts` mints one SVG `<text>` per cloud into `#cloud-labels`
and wires each through the shared shell-label engine
(`createShellSilhouetteLabel` — identical placement to the Local Bubble
and heliopause labels: silhouette support point + bottom-right offset +
chase lerp, near-plane bail hides the label with the camera inside).
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
Raycasting ignores mesh visibility, so picking works while the rim is
decluttered or in chart mode. The click handler in `onPointerUp` falls
back to a cloud pick when no star is hit (stars take priority because
they're the smaller, more precise target), and the hover engine runs
the cloud module's provider, so hovering over a cloud's body shows its
name + distance + axes in the existing tooltip element.

**One winner resolver, in the layer.** `MolecularClouds.pick` is the
single entry point behind the module's one pick surface — the click
FSM (via `Picker.pickKindHit('cloud', …)`) and the hover engine run
the same function, so the two can never disagree on which of two
overlapping clouds the cursor is on. A tiebreak living in the click
handler instead would drift the moment either surface changes. (The
old click-side warp gate is subsumed by the FSM's `blocksClick()`.)
Hover tier is always `fallback`: stars, planets, LG objects and shells
win any overlap with a cloud body.

**Proportionally-deepest-inside wins.** The raycast is *only* the
hit-vs-miss gate (every hit means the cursor is genuinely inside that
cloud's outline). Among the hits, the winner is the lowest

    score = pxDistFromProjectedCentre / (renderedSizePx / 2)

— the cursor's offset from the cloud's projected centre as a fraction of
that cloud's *own* projected radius (0 = dead centre, 1 = at the edge),
via `cloud-pick-pure.ts`. Ray distance is deliberately not a tiebreak:
"closest to camera wins" (Three.js `intersectObjects` order) makes the
background cloud unreachable wherever a foreground one overlaps it — the
same failure the star picker's `pickScore` rejected. Raw pixel distance
to the nearest centre is equally wrong in the other direction: clouds
span a ~10× on-screen size range, so a small cloud is within a few dozen
px of its own centre almost everywhere inside itself and would take the
whole overlap region. Scale-invariance is the property that keeps both
reachable. Accepted trade: near the edge of a big complex, an
overlapping small cloud takes the pick — that is what makes the small
cloud reachable at all.

Projection is against the **effective centre** (§ Effective focus
geometry), and the denominator is the layer's `renderedSizePx` — the
extent sphere for traced clouds, the tight ellipsoid quadric otherwise,
both at the depicted `u = uEnv` envelope, keyed off the canonical
shader-side pixels-per-radian (`KindContext.angularToPx()`, which reads
the shared view uniforms the star passes write) so the score matches the
silhouette the user actually clicked inside.
Every hit enters the shared `pickFromCandidates` reducer as a prime-tier
candidate with `hitRadius: Infinity` — see `cloudPickCandidate` for why a
real radius would misclassify near-lobe hits.

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
- `setRimParams({alphaLimb, faceOnFloor, fresnelPower})` — rim shape,
  shared vocabulary with the fresnel shells
- `setSteps(n)` — absorption raymarch step count
- `setMonoOpacity(x)` / `setMonoColor(0xRRGGBB)` — chart outline tuning
- `setDebugBoost(strength)` — boost the rim glow (or `null` to
  restore); use this first when "I can't see anything" to confirm the
  layer is rendering at all.
