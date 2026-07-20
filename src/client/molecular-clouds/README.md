# Molecular cloud presence layer

`molecular-clouds.ts` renders the ~96 named local SF clouds as an
orientation aid, the Local-Bubble treatment applied per cloud: a
fresnel-rim whisper silhouette plus a physically-driven absorption
alpha, both fed by one band-limited raymarch of the calibrated Zucker
density model (`docs/molecular-clouds.md` §§ 4–5, 9). A
`representational`-tier declutter element (`molecularCloudEllipsoids`,
`../scene/README.md`) — decluttering to `physical` hides the mesh
entirely, leaving pure per-star extinction physics. Stays visible
during warp by design (flying past Taurus is a feature, not noise).

The runtime renderer fetches `public/clouds.json` via `cloud-loader.ts`
(version gate: v2 — the calibrated density-model fields + the
`noiseModel` block per `docs/molecular-clouds.md` § 8; a missing
`noiseModel` rejects like a version mismatch).
Each cloud carries a frozen Stellata ID (`sid`, docs/sid.md § 7); the
loader rejects the artifact (warn + null, same as a version mismatch)
when any sid is missing or duplicated — a pre-stamp `clouds.json` needs
`pnpm run build:clouds`. The resolver's `cloud` SID domain attaches in
`main.ts` when the catalog loads (see `../util/sid-resolver/README.md`).

## Files

- `molecular-clouds.ts` — `MolecularClouds` renderer + the silhouette /
  viewing-distance helpers.
- `cloud-loader.ts` — `clouds.json` v2 fetch/decode.
- `cloud-presence-pure.ts` — CPU mirror of the shader math (octave
  ladder, PCG3D value noise, band-limit fade, Plummer density,
  absorption alpha). Vitest-pinned.
- `cloud-mock.ts` — `Cloud`/`CloudCatalog` test fixture builders.
- `cloud.vert.glsl`, `cloud.frag.glsl` — the presence shader pair.

## Render

Every cloud is one shared `SphereGeometry(1.03, 32, 16)` mesh scaled
per-instance to its semi-axes and rotated by its quaternion (the 3%
inflation covers tessellation sag; the shader clips to the analytic
unit sphere). The fragment shader raymarches the ellipsoid segment
(12–16 jittered steps) through the calibrated Plummer profile times
the log-normal octave noise, band-limited per
`docs/molecular-clouds.md` § 9.1: only octaves with λ ≥ 2·step feed
the integral; the fine octaves (ridged on the finest two) apply as one
post-integral texture factor clamped to [0.6, 1.4], with sub-pixel
wavelengths faded by the screen-space footprint. Constants flow
`cloud_model.py` → `clouds.json` `noiseModel` → `buildOctaveLadder` →
uniforms — never redefined shader-side.

One draw carries both components under **premultiplied alpha** +
`NormalBlending` — rgb is the additive rim glow, alpha the absorption,
so the blend `(ONE, ONE−α)` yields `glow + background × (1−absorption)`.
Without `premultipliedAlpha: true`, src.alpha multiplies into rgb a
second time and the glow collapses. The whisper glow is the shared
fresnel-rim shape (`../fresnel-shell/fresnel-rim.glsl`, the
`stellata_fresnel_rim` chunk registered by `fresnel-shell.ts`)
evaluated at the ray's entry point, class-tinted (dark / sf / hii),
textured by the fine octaves, and suppressed when the camera is inside
the envelope — the fresnel-shell hide-when-inside contract applied to
the glow only, while the absorption keeps working from inside the
cloud. Output carries a ±0.5-LSB gradient-noise dither (the whisper
level spans only ~13–38 8-bit levels).

The material is `BackSide`: exactly one fragment per covered pixel
from outside and inside (the raymarch segment is analytic either way);
`FrontSide` would kill the inside-the-cloud absorption. The shaders
avoid the `#version 300 es` directive and don't redeclare
auto-injected attributes (`position`, `normal`, `modelMatrix`, etc.);
doing either silently breaks the GLSL3 compile. Mono mode swaps to a
soft grey alpha-over of the absorption column.

**Render-order contract** (`docs/molecular-clouds.md` § 9.1 rule 5):
the absorption alpha dims only layers drawn *before* the presence mesh
(`renderOrder −2`). Every diffuse background the clouds should extinct
— the MW band and LG emission (−3), any future HiPS / sky-imagery
layer — must render earlier; a layer added after the mesh silently
escapes extinction. Point sources are exempt (the per-star raymarch
owns their extinction; no double-count). The reference wireframes at
−1 (galactic disc/grid, Local Bubble shell) deliberately draw after
the mesh — chart-like chrome shouldn't be extincted.

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

Per-cloud `Mesh` objects participate in `THREE.Raycaster` intersection
via the cloud `Group`. `Picker.pickCloud` does the raycast; the click
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
- `setColor(0xRRGGBB)` — override the per-class tints
- `setRimParams({alphaLimb, faceOnFloor, fresnelPower})` — rim shape,
  shared vocabulary with the fresnel shells
- `setSteps(n)` / `setTexGain(x)` — raymarch step count, fine-octave
  texture strength
- `setMonoOpacity(x)` / `setMonoColor(0xRRGGBB)` — chart mode tuning
- `setDebugBoost(strength)` — boost the rim glow (or `null` to
  restore); use this first when "I can't see anything" to confirm the
  layer is rendering at all.
