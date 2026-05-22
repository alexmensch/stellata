# Molecular cloud overlay

> **Status:** Shelved. `FilterState.showMolecularClouds` defaults
> to `false`, the user-facing toggle is removed from the panel, and the
> URL flag bit 2 is reserved (no longer encoded). The render path,
> shaders, and renderer code in this folder are all preserved so the
> layer can be re-enabled with a default flip once the visual treatment
> is refined. Chart-mode integration (`setCloudsIsobar`) is still wired
> against the now-invisible group.

`molecular-clouds.ts` renders ~96 named local SF clouds as soft warm
ellipsoids. Originally default-on with a toggle in the Galactic-overlays
panel section; the toggle is now gone and the layer renders nothing.
Stays visible during warp by design (flying past Taurus is a feature,
not noise) — relevant once re-enabled.

Build pipeline + reference data live with their respective folders:

- Build script + Z2020/Z2021 merge logic: `scripts/clouds/README.md`.
- Reference data: `data/molecular-clouds/README.md`.

The runtime renderer fetches `public/clouds.json` via `cloud-loader.ts`.

## Render

Every cloud is one shared `SphereGeometry(1, 32, 16)` mesh scaled
per-instance to its semi-axes and rotated by its quaternion. The
fragment shader derives a smooth view-direction-based density —
`pow(|n·v|, 1.5)` — so silhouettes fade rather than hard-edge. Material
uses `DoubleSide` so the layer reads correctly when the camera is inside
a cloud. **Premultiplied alpha** is critical: the shader bakes intensity
into rgb (`vec4(col × intensity, intensity)`) and the material sets
`premultipliedAlpha: true`, so additive blending becomes `(ONE, ONE)` —
without it, src.alpha multiplies into rgb a second time and the cloud
comes out ~30× too dim to see. The shaders also avoid the `#version
300 es` directive and don't redeclare auto-injected attributes
(`position`, `normal`, `modelMatrix`, etc.); doing either silently
breaks the GLSL3 compile. Mono mode swaps to a soft warm grey with
normal alpha-over.

## Unified focus / measurement / warp UX

Clouds are full participants in the click-state machine alongside
stars. Internal state holds two mutually-exclusive pairs: `focusedStar`
/ `focusedCloud` and `vectorTo` (star idx) / `vectorToCloud`. The click
handler dispatches by what was picked under the cursor — a cloud pick
from a star focus sets a star→cloud measurement vector; a cloud pick
from a cloud focus sets a cloud→cloud vector; clicking the current
vector tip (star or cloud) triggers a focus-park lerp via `focusStar`
or `flyToCloud` (see `src/client/camera/controls/README.md` § Focus-park
lerp); pressing W or clicking the distance label dispatches to `warpTo`
or `warpToCloud` based on which vector slot is active. The two
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
dispatches by kind — cloud picks call `flyToCloud` (focus-park lerp to
viewing distance + set cloud focus); the To (distance vector) box
accepts both, dispatching to `setVectorToCloud` for cloud picks.

## Focus + warp entry points

**`setOrbitTargetCloud(cloudIdx)`:** the click-without-focus path —
mirrors `setOrbitTarget` for stars. Moves orbit pivot to the cloud
centroid and sets the cloud focus, but leaves the camera position
unchanged. Camera doesn't teleport; user pivots around the cloud from
their current vantage. Calls `setFocusedCloud` first, which clears any
star focus; the floating origin stays at the former focal star instead
of snapping back to Sol, so the cloud's absolute centroid is converted
to local-frame coordinates by subtracting `worldOffset` before assigning
to `controls.target`.

**`flyToCloud(cloudIdx)`:** the focus-park path — used by search-select
and click-vector-tip. Mirrors `focusStar`: clears prior focus + vector,
then composes the generic `parkDistance(...)` primitive with the cloud's
max-semi-axis as `R_pc` and `cloudViewingDistancePc(cloud)` as
`dMinFloor`. Lerps over `FOCUS_LERP_MS` when the camera is currently
outside park, or stays put when inside. `animate: false` (URL-restore)
snaps. For animated travel between distant focal points the user warps
via the distance label.

**`warpToCloud(destIdx)`:** the cloud-destination warp. Source point is
the currently-focused star OR cloud (`currentFocusLocalPos`); destination
is the cloud's centroid; arrival offset is `cloudViewingDistancePc`. The
internal `WarpState` carries a `destKind: 'star' | 'cloud'` discriminator
so `finishWarp` parks at the right point and dispatches to either
`setFocus` or `setFocusedCloud` on arrival.

## Floating-origin handling

Clouds live in absolute ICRS space; the group's `position` is rebased
to `-worldOffset` per frame, the same pattern as `GalacticDisc`. So
focusing on a far star (which shifts the floating origin to that star's
absolute position) doesn't move clouds visually — they stay anchored
where they should.

## URL state

Cloud focus and the cloud measurement vector ride in the shared `?v=`
blob (mutually exclusive with star focus and the star measurement vector
respectively). The MC overlay disable flag also lives there (flags-byte
bit 2, default-omitted since the layer is default-on). See
`src/client/util/url-state/README.md`.

## Dev-console levers

Under `stellata.cloudLayer.*`:
- `setOpacity(x)` / `setColor(0xRRGGBB)` — dark mode tuning
- `setMonoOpacity(x)` / `setMonoColor(0xRRGGBB)` — chart mode tuning
- `setDebugBoost(strength)` — force max-opacity (or `null` to restore);
  use this first when "I can't see anything" to confirm the layer is
  rendering at all.
