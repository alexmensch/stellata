# Molecular cloud layer

`molecular-clouds.ts` renders the ~96 named local SF clouds as two
decoupled components per cloud:

- **Absorption** — a per-fragment raymarch of the calibrated Zucker
  density model (`docs/molecular-clouds.md` §§ 4, 9) that dims every
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

The runtime fetches `public/clouds.json` via `cloud-loader.ts`
(version gate: v2; the client reads the geometry + density-model fields
and ignores the build-side `noiseModel` block) and
`public/cloud-surfaces.bin` via `cloud-surfaces-loader.ts` (sid-keyed
meshes; a missing artifact means every cloud uses its ellipsoid rim).
Each cloud carries a frozen Stellata ID (`sid`, docs/sid.md § 7); the
loader rejects the artifact (warn + null, same as a version mismatch)
when any sid is missing or duplicated — a pre-stamp `clouds.json` needs
`pnpm run build:clouds`. The resolver's `cloud` SID domain attaches in
`main.ts` when the catalog loads (see `../util/sid-resolver/README.md`).

## Files

- `molecular-clouds.ts` — `MolecularClouds` renderer + the silhouette /
  viewing-distance helpers.
- `cloud-loader.ts` — `clouds.json` v2 fetch/decode.
- `cloud-surfaces-loader.ts` — `cloud-surfaces.bin` fetch/decode
  (format: `scripts/cloud-surfaces/README.md`).
- `cloud-presence-pure.ts` — CPU mirror of the absorption math (Plummer
  density, absorption alpha). Vitest-pinned.
- `cloud-mock.ts` — `Cloud`/`CloudCatalog` test fixture builders.
- `cloud-absorption.vert.glsl`, `cloud-absorption.frag.glsl` — the
  absorption raymarch pair.
- `cloud-rim.frag.glsl` — the rim/outline fragment stage; the vertex
  stage is the shared `../fresnel-shell/fresnel-shell.vert.glsl`.

## Absorption render

Every cloud is one shared `SphereGeometry(1.03, 32, 16)` mesh scaled
per-instance to its semi-axes and rotated by its quaternion (the 3%
inflation covers tessellation sag; the shader clips to the analytic
envelope sphere). The fragment shader raymarches the ellipsoid segment
(4–14 jittered steps, screen-adaptive) through the calibrated Plummer
profile and converts the A_V column to `α = 1 − exp(−0.921·A_V)`,
capped at 0.95. The draw is **alpha-only premultiplied over** (rgb = 0
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

**Render-order contract** (`docs/molecular-clouds.md` § 9.1 rule 5):
the absorption alpha dims only layers drawn *before* the absorption
meshes (`renderOrder −2`). Every diffuse background the clouds should
extinct — the MW band and LG emission (−3), any future HiPS /
sky-imagery layer — must render earlier; a layer added after the mesh
silently escapes extinction. Point sources are exempt (the per-star
raymarch owns their extinction; no double-count). The reference chrome
at −1 (galactic disc/grid, Local Bubble shell, the cloud rim shells
themselves) deliberately draws after the mesh — annotation shouldn't
be extincted.

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

- **Realistic:** additive fresnel rim (`stellata_fresnel_rim` chunk),
  whisper-level (`uAlphaLimb` 0.15 vs the boundary shells' 0.45–0.5 —
  96 rims at shell strength would dominate the sky), ±0.5-LSB dither.
- **Chart:** the material swaps to `NormalBlending` ink and the shader
  emits a stippled silhouette contour — an fwidth-scaled band where
  n·v → 0, masked by a screen-space dot grid.

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
park-distance inputs use `cloudViewingDistancePc` (= `2.4 × max(axes)`,
with a 5 pc floor) as the cloud's `dMinFloor` instead of the star
90 %-fill solve.

## Picking + hover

Per-cloud absorption `Mesh` objects participate in `THREE.Raycaster`
intersection. `Picker.pickCloud` does the raycast; the click
handler in `onPointerUp` falls back to a cloud pick when no star is hit
(stars take priority because they're the smaller, more precise target),
and the hover engine's `cloud-hover-provider` calls `Picker.pickCloudHit`
so hovering over a cloud's body shows its name + distance + axes in the
existing tooltip element.

## Search

Cloud entries share the same Fuse fuzzy index as star entries,
discriminated by a `kind: 'star' | 'cloud'` tag. The Focus search box
dispatches `flyTo` with the entry's Target (focus-park lerp to viewing
distance + set cloud focus); the To (distance vector) box dispatches
`setVector` the same way.

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
primitive with the cloud's max-semi-axis as `R_pc` and
`cloudViewingDistancePc(cloud)` as `dMinFloor` (the provider's
`focusParkDistance` leg). Lerps over `FOCUS_LERP_MS` when the camera
is currently outside park, or stays put when inside. `animate: false`
(URL-restore) snaps. For animated travel between distant focal points
the user warps via the distance label.

**`warpTo({kind:'cloud', idx})`:** the cloud-destination warp. Source
point is whatever is focused (`currentFocusTarget()`); destination is
the cloud's centroid; arrival offset is `cloudViewingDistancePc`.
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

Under `stellata.cloudLayer.*`:
- `setOpacity(x)` — master rim-glow gain (dark mode)
- `setColor(0xRRGGBB)` — override the shared rim blue
- `setRimParams({alphaLimb, faceOnFloor, fresnelPower})` — rim shape,
  shared vocabulary with the fresnel shells
- `setSteps(n)` — absorption raymarch step count
- `setMonoOpacity(x)` / `setMonoColor(0xRRGGBB)` — chart outline tuning
- `setDebugBoost(strength)` — boost the rim glow (or `null` to
  restore); use this first when "I can't see anything" to confirm the
  layer is rendering at all.
