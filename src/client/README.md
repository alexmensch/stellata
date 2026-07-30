# Browser client

The integration shell + cross-cutting plumbing. `stellata.ts` is the
Three.js scene + state machine + event bus that composes the
per-subsystem controllers. Per-subsystem folders (every other
directory under `src/client/`) own their own topic and document
themselves.

## Folder layout

- `main.ts`, `stellata.ts`, `index.html`, `styles.css`, `globals.d.ts`
  — bootstrap + integration shell. `index.html`'s `<head>` also
  carries the SEO / OpenGraph / Twitter meta, canonical, favicon links,
  and Schema.org JSON-LD; the `<body>` opens with a `<noscript>`
  crawler/GEO fallback describing the app. The referenced static assets
  (`og-image.jpg`, icons, `robots.txt`, `llms.txt`, `sitemap.xml`,
  `manifest.webmanifest`) live in `public/`.
  **No loader in `main.ts`'s boot `Promise.all` may reject.** One rejection
  blanks the whole app, so an optional artifact must resolve null instead —
  including on a parse error, since `not_found_handling =
  "single-page-application"` (`wrangler.toml`) answers a missing asset with
  index.html at 200 rather than a 404. `solar-system/probes/probe-loader.ts`
  is the pattern to copy; warn-then-null on a present-but-invalid artifact
  (`local-group/local-group-loader.ts`) is the shape for shape errors.
- `stellata-events.test.ts` — integration-shell event-emission test.
- `util/` — project-agnostic plumbing (event bus, URL state).
- `filters/` — `FilterState` + the instrument record (aperture-derived
  limiting magnitude, plate-scale star sizing) + render knobs and the
  `FilterController` that owns every mutation.
- `scene/` — the `SceneLayer` contract + registry driving the
  per-layer update / monochrome / recenter / dispose fan-outs.
- `hdr/` — the float render target every light-emitting layer draws
  into and the fullscreen tone-map that resolves it to the canvas.
  Owns the shared operator chunk, its CPU mirror, and the chrome
  colour inverse-mapping. `hdr/exposure/` owns the scalar they run on —
  instrument limit, per-frame scene adaptation, EV trim — and
  `hdr/exposure/reduction/` reduces the target's statistic attachment
  to the two numbers the cut runs on. Chart mode bypasses all of it.
- `local-depth/` — the bracketed local depth pass: camera-relative
  depth slices giving close bodies (moons, rings, binary pairs) true
  z-buffer occlusion the main pass's log depth cannot. The planet
  mesh LOD renders through it; the design doc for the remaining
  migration steps lives in its README.
- `camera/` — camera controllers split across `controls/`, `focus/`,
  `warp/`, `observe/`, `arrival/`.
- `star-pipeline/`, `solar-system/`, `local-group/`, `milkyway/`,
  `galactic/` (galactic reference geometry + both coordinate
  spheres), `molecular-clouds/`, `chart-mode/`, `dust/`,
  `local-bubble/`, `constellation-figure/` — render layers.
- `constellation-boundaries/` — the IAU (Delporte 1930) boundary arcs:
  the B1875 edge set, the positional lookup answering which constellation
  any position falls in, and the chart-mode layer that draws the
  partition on a Sol-centred sphere.
- `fresnel-shell/` — shared translucent-boundary-shell primitive
  (material + shader pair + gating base) used by the heliopause and the
  Local Bubble.
- `hover/`, `overlays/`, `ui/`, `typeahead/`, `modals/`, `debug/` —
  cross-cutting UI.
- `system-membership/` — kind-generic multi-object system contract
  (roster + collapsed-cluster queries) behind the hover system card
  and collapsed-pick-to-primary resolution; implemented by
  `binaries/` and `solar-system/`.
- `loaders/` — runtime fetch/parse of `public/` artifacts.

## Event bus on `Stellata`

Subscribers register via `stellata.on(name, fn)` and receive a typed
payload per event. `on` returns an unsubscribe — call it to detach.
The payload map is `StellataEventMap` in `stellata.ts`.

- `'focus'` (`Target | null`) — focused object changed (any kind, from
  any source). The kind-tagged payload carries the whole transition —
  a kind change is one emit, never a clearing emit followed by a set.
- `'planetSystem'` (`PlanetSystem | null`) — focused star's planet
  system loaded, cleared, or swapped.
- `'vector'` (`Target | null`) — distance-vector destination changed
  (any kind; the single slot makes kinds mutually exclusive).
- `'filter'` (`Readonly<FilterState>`) — any filter patch applied.
- `'cameraMode'` (`'navigate' | 'observe'`) — camera mode flipped.
  Used by the mode toggle, search-row label swap, and scale-bar
  (which switches to angular degrees in observe).
- `'warp'` (`boolean`) — warp animation start/finish.
- `'pois'` (`readonly Target[]`) — pinned-object list changed (shared
  across camera modes — see `poi/README.md`).
- `'noopClick'` (`{ x, y }`) — a canvas click ran its per-mode
  dispatch and changed nothing (empty sky, rejected pin). Drives the
  click-ripple feedback overlay; clicks that did something don't emit
  it.
- `'frame'` (no payload) — called after each render, used by all SVG
  overlays.
- `'state'` (no payload) — fires on any discrete state mutation. This
  is what the URL-sync module listens to. Don't fire it from a
  `'frame'` handler for camera changes — the URL sync has its own
  frame hook with hash comparison for that.

Emission pairing: each fine-grained mutation event (`'focus'`,
`'vector'`, `'filter'`, `'cameraMode'`, `'pois'`, warp start) is
followed by a `'state'` emit
from the same mutation site, so a `'state'` subscriber observes every
mutation without enumerating the fine-grained names. `'planetSystem'`
(derived from a focus change that already paired with `'state'`),
`'frame'`, `'focusLerp'`, `'noopClick'` (transient feedback, not a
state mutation), and the warp-end edge emit alone.

## Click-state machine (`camera/controls/input/input-controller.ts`)

Canvas clicks in BOTH modes are held for `DBL_CLICK_MS` (280 ms) by a
shared `PendingClickDispatcher` (`util/pending-click.ts`) so single
and double clicks disambiguate; the deferred handlers re-check the
warp / aim / transition guards at fire time.

Navigate clicks pick ladder-eligible objects first — stars, planet
bodies, Local Group objects, AND boundary shells (fallback tier),
tiebroken by the hover engine's rule
(`bestHitBy`: prime beats fallback, then closer camera) so click and
hover can't disagree on which object wins an overlap — then fall back
to clouds.

Navigate single-click on a ladder-eligible object — ONE table for
stars, planets, LG objects, and boundary shells alike
(`applyObjectClick`); no kind is
a special case, and neither is any future pinnable kind:

| condition | action |
| --- | --- |
| no focus | travel to clicked object (`flyTo`) |
| clicked = focused, no vector | unfocus |
| clicked = focused, vector drawn | clear vector (stay focused; the destination stays pinned) |
| clicked = other object, unpinned | pin as POI (ladder rung 1 — Sol / at-cap fall through to rung 2) |
| clicked = other object, pinned, not vector destination | set vector focus → clicked |
| clicked = other object, pinned + vector destination | clear vector AND unpin |

The ladder decision table is `poi/click-ladder-pure.ts`; the pin
rungs require the HUD (`showHud`) to be on — pins are HUD widgets, so
with the HUD hidden clicks step only the vector rungs. Navigate
**double-click** on any star, planet, LG object, or cloud travels to
it via `flyTo` (the focus-park teleport that clicking the vector tip
used to trigger; lerps over `FOCUS_LERP_MS` or no-ops when already
inside park). The POI overlay's on-screen labels route through the
same `applyObjectClick` semantics.

Cloud clicks keep the pre-ladder vector-first semantics (orbit-target
on first pick from no focus, vector destination on pick from a focus,
click-destination-to-travel); folding clouds into the click ladder is
tracked as its own bead.

In OBSERVE mode single-click is the pin/unpin toggle
(`applyObjectClick`'s observe branch, gated on `showHud` — stars and
planets alike) and
double-click slerps the camera so the clicked direction lands at view
centre; plain drags land on the custom look-around controller
(direct-manipulation drag + wheel-FOV). A **Shift+drag** is the roll
gesture in both modes and is claimed by `InputController` — the
look-around controller and TrackballControls each bail out of that
pointer stream (`camera/controls/input/README.md` § Roll gestures). The
SVG-layer Sol/GC arrow labels remain clickable; they route through `aimAt(localPoint)`,
which has its own observe-mode branch that slerps the camera
quaternion in place.

## Floating origin (large-world precision)

Close-range orbit of a star far from Sol used to jitter visibly because
Three.js composes its `modelViewMatrix` at float32 precision. At 1 kpc
from Sol, the translation column quantises to ~10⁻⁴ pc — 2–3% of the
min-orbit radius — so every frame the projected position snapped around
by a few pixels.

Fix: the renderer runs in a **floating local frame** whose origin tracks
the currently focused star.

- The buffers themselves live on `StarFrame`
  (`star-pipeline/frame/README.md`): `worldOffset`, the
  absolute-space coordinate currently sitting at the renderer's
  (0,0,0) — starts at Sol — and `localPositions` (exposed via
  `stellata.localPositions`), a `Float32Array` of
  `catalog.positions − worldOffset` bound to the `iPosition` instance
  attribute, which is what every overlay and pick path projects
  through.
- `Stellata.recenterOrigin(newOrigin)` (exposed via the `FrameAnchor`
  seam) has `StarFrame` rewrite that buffer using JS Number (= float64)
  subtraction, then shifts `camera.position` and `controls.target` by
  the same delta so the user sees no jump. The two callers are
  `FocusController.recenterFocusToStar` (focus mutations) and
  `WarpController.tryMidFlyRecentre` (mid-flight pivot onto the
  destination).
- `FocusController.setFocus(idx)` calls `recenterOrigin` on focus, then
  snaps `controls.target` onto the focal star's **live** local position
  (catalog baseline + orbital perturbation), not the bare local origin —
  a binary member sits at its perturbed position. For a non-orbiting star
  that live position IS the local origin. **Unfocus does *not* recenter**
  — `worldOffset` stays at the former focal object so
  camera/target/iPosition all remain in their float32-clean local frame.
  Recentering on unfocus used to cause a visible jump (the `idx===null`
  branch shifted `target` by the focal star's full world position,
  breaking the pin invariant below and re-introducing cancellation in the
  projection chain).
- **Focal-frame ride.** A focused binary member drifts along its orbit
  each frame; the shell translates `camera.position` + `controls.target`
  (and in-flight camera-transition pose caches) by that per-frame drift
  so the star stays under the camera and the pin stays engaged. Focus and
  unfocus of a pair member therefore cause no position discontinuity —
  see `binaries/README.md` § Focal-frame ride.
- **Default-load** (a7d.2.8) auto-engages `setFocus(catalog.solIndex)`
  before the first frame so URL-less loads start with the pin engaged
  and the per-Sol orbit floor in effect, matching every other entry
  point (warp arrival, observe→navigate, search-select). The URL
  encoder treats Sol as the canonical default focus and *omits* the
  field when focused on Sol; "explicitly unfocused" rides a separate
  presence bit so the three states (default-Sol / specific star /
  cleared) round-trip unambiguously.

The key precision win: the big `absolute − offset` subtractions happen
in JS float64 on the CPU, producing small float32 deltas near zero with
~10⁻³⁸ resolution. The GPU's modelview matrix then only carries
kilo-parsec-scale values when the camera is far from the local origin
(i.e. zoomed out, where pixel-level jitter is imperceptible anyway).

Implications for code that reads positions:
- **Rendering / projection math** must use `stellata.localPositions`
  (same frame as `camera.position` and `controls.target`). The disc
  mask, focus ring, distance vector, constellation overlay, and all
  `Picker.pickStar` / `renderedSizePx` / `aimAtConstellation` paths
  do this.
- **Distance-from-Sol** (the distSol filter, the Sol locator-arrow
  label) must use `catalog.positions` *or* must compute
  `||localPosition + worldOffset||` in JS float64. (Hover-card and
  focus-card distances are camera-relative by design — they read the
  local frame directly.) The shader's
  distSol filter consumes a precomputed per-instance `iDistSol`
  attribute instead of `length(iPosition)`, because the latter is now
  a local-frame value. The Sol arrow uses the float64 sum approach so
  its distance label updates correctly under any focus.
- `starLocalPosition(i)` (formerly `starWorldPosition`) returns the
  local-frame vector — use it for camera math, never for Sol-distance.

URL round-trip works without special handling for the focused case
because sender and receiver both recenter on the same focus star.
Camera/target serialise in local frame; loading the URL recenters to
the same absolute origin and the local coordinates apply unchanged.

For unfocused-but-not-at-Sol, the URL serialises a `worldOffset` field
(FIELDS_V2 bit 20, vec3 Float32, appended to the end for forward-compat
with older clients). The encoder emits it when `focusedStar === null`
AND `worldOffset` isn't ≈Sol; cam/tgt then encode in the local frame
and round-trip with full Float32 precision. The loader applies
`setWorldOffset` *before* cam/tgt and resets cam/tgt to defaults so a
missing `view.cam` / `view.tgt` produces a sane pose in the new local
frame. Old URLs without `worldOffset` decode as Sol-anchored (legacy
behaviour).

The general design treats `worldOffset` as a free Float32 vec3 anchor
(not a catalog ref): future object types (clouds, planets, probes,
exoplanets) can each set it on focus without coupling to the star
catalog index space. Float32 precision is sufficient at any magnitude
because the user-visible pose is the cam/tgt offset *within* the
local frame, stored at full Float32 precision relative to the anchor.

## Full render stack — front to back

The full layer composition is something `stellata.ts` owns at the
integration shell — each subsystem renders into the same scene, and
which layer wins which pixel is the property that emerges here.
Each row links to the README that owns the layer's implementation.

Every WebGL row below renders into the HDR target, not the canvas —
including the local depth pass, whose repaint lands in the same target.
One fullscreen tone-map then resolves the target to the canvas, so
nothing in the table composites against the canvas directly and the SVG
layer sees only the resolved frame ([hdr/](hdr/README.md)). Chart mode
bypasses the target and renders straight to the canvas as before.

One pass draws after the resolve and appears nowhere in the table: the
exposure statistic's mip reduction, which binds its own targets, writes no
pixel the user sees, and is read back a frame later
([hdr/exposure/reduction/](hdr/exposure/reduction/README.md)). Every row
below that emits physical light also writes the target's second,
statistic attachment ([hdr/statistic/](hdr/statistic/README.md)); every
chrome row is gated out of it.

There is no z-ordering between WebGL and SVG. The WebGL canvas paints
first; the SVG `#overlay` always sits above it (`z-index: 5`,
`pointer-events: none`). Inside each layer the ordering is local:
WebGL by `THREE.Object3D.renderOrder`, SVG by source order in
`src/client/index.html` (later child = on top). The constellation
figure is depth-tested WebGL line geometry (`renderOrder −0.75`), so
close star and planet discs occlude it through the depth buffer — no
SVG mask (`constellation-figure/README.md`).

| Layer                                            | Surface | Mechanism                                          | Order | Owner |
| ------------------------------------------------ | ------- | -------------------------------------------------- | :---: | ----- |
| Focus ring                                       | SVG     | source order (last child)                          | front | [overlays/](overlays/README.md) |
| Click ripple                                     | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Heliopause label                                 | SVG     | source order                                       |       | [solar-system/heliopause/](solar-system/heliopause/README.md) |
| Local Bubble label                               | SVG     | source order                                       |       | [local-bubble/](local-bubble/README.md) |
| Molecular cloud labels                           | SVG     | source order                                       |       | [molecular-clouds/](molecular-clouds/README.md) |
| Planet labels                                    | SVG     | source order                                       |       | [solar-system/planets/](solar-system/planets/README.md) |
| Probe labels                                     | SVG     | source order                                       |       | [solar-system/probes/](solar-system/probes/README.md) |
| POI labels                                       | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| POI rings                                        | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| POI arrows                                       | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Sol/GC arrow labels                              | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| Distance label + warp pill                       | SVG     | source order                                       |       | [overlays/](overlays/README.md), [camera/warp/](camera/warp/README.md) |
| Distance vector + bg                             | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Sol/GC arrows + bg                               | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| HUD ring                                         | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| Coordinate-sphere edge labels                    | SVG     | source order (first SVG children)                  |       | [galactic/coord-spheres/](galactic/coord-spheres/README.md) |
| *— SVG / WebGL boundary —*                       | —       | `.overlay { z-index: 5 }`                          | —     | — |
| Planet glow mirror (cluster members)             | WebGL   | local depth pass; bracket z-buffer (4 in-pass)     |       | [solar-system/planets/](solar-system/planets/README.md), [local-depth/](local-depth/README.md) |
| Member-star glow mirror                          | WebGL   | local depth pass (3.5 in-pass)                     |       | [star-pipeline/local-pass/](star-pipeline/local-pass/README.md), [local-depth/](local-depth/README.md) |
| Probe marker mirror (cluster active)              | WebGL   | local depth pass (3.3 in-pass)                     |       | [solar-system/probes/](solar-system/probes/README.md), [local-depth/](local-depth/README.md) |
| Probe trail mirror (cluster active)               | WebGL   | local depth pass (3.25 in-pass)                    |       | [solar-system/probes/](solar-system/probes/README.md), [local-depth/](local-depth/README.md) |
| Orbit rings                                      | WebGL   | local depth pass (3.2 in-pass)                     |       | [solar-system/ephemerides/](solar-system/ephemerides/README.md), [local-depth/](local-depth/README.md) |
| Binary orbit paths                               | WebGL   | local depth pass (3.2 in-pass)                     |       | [binaries/](binaries/README.md), [local-depth/](local-depth/README.md) |
| Planet atmosphere shell (Venus/Earth/Mars/Titan) | WebGL   | local depth pass; additive (2.82 in-pass)          |       | [solar-system/atmosphere/](solar-system/atmosphere/README.md), [local-depth/](local-depth/README.md) |
| Planet ring annulus (Saturn/Uranus/Neptune)      | WebGL   | local depth pass; bracket z-buffer (2.81 in-pass)  |       | [solar-system/planets/](solar-system/planets/README.md), [local-depth/](local-depth/README.md) |
| Planet spheroid mesh (close LOD)                 | WebGL   | local depth pass; bracket z-buffer (2.8 in-pass)   |       | [solar-system/planets/](solar-system/planets/README.md), [local-depth/](local-depth/README.md) |
| Member-star disc mirror                          | WebGL   | local depth pass (0 in-pass)                       |       | [star-pipeline/local-pass/](star-pipeline/local-pass/README.md), [local-depth/](local-depth/README.md) |
| Member-star core mask (depth-only)               | WebGL   | local depth pass (−1 in-pass, `colorWrite: false`) |       | [star-pipeline/local-pass/](star-pipeline/local-pass/README.md), [local-depth/](local-depth/README.md) |
| *— local depth pass boundary (depth cleared) —*  | —       | drawn after the whole main pass                    | —     | — |
| Planet glow (inactive-cluster hosts)             | WebGL   | `renderOrder: 4`                                   |       | [solar-system/planets/](solar-system/planets/README.md) |
| Probe markers (cluster inactive)                  | WebGL   | `renderOrder: 3.5`                                 |       | [solar-system/probes/](solar-system/probes/README.md) |
| Probe trails (cluster inactive)                   | WebGL   | `renderOrder: 3.4`                                 |       | [solar-system/probes/](solar-system/probes/README.md) |
| Dust particles                                   | WebGL   | `renderOrder: 2`                                   |       | [dust/](dust/README.md) |
| Star glow + heliopause shell                     | WebGL   | `renderOrder: 1`                                   |       | [star-pipeline/](star-pipeline/README.md), [solar-system/heliopause/](solar-system/heliopause/README.md) |
| Star disc                                        | WebGL   | `renderOrder: 0`                                   |       | [star-pipeline/](star-pipeline/README.md) |
| Constellation figure                             | WebGL   | `renderOrder: -0.75`                               |       | [constellation-figure/](constellation-figure/README.md) |
| IAU constellation boundaries (chart only)        | WebGL   | `renderOrder: -0.8`                                |       | [constellation-boundaries/](constellation-boundaries/README.md) |
| Galactic disc + coordinate spheres               | WebGL   | `renderOrder: -1`                                  |       | [galactic/](galactic/README.md), [galactic/coord-spheres/](galactic/coord-spheres/README.md), [local-group/](local-group/README.md) |
| Local Bubble shell                               | WebGL   | `renderOrder: -1`                                  |       | [local-bubble/](local-bubble/README.md) |
| Molecular cloud rim shells                       | WebGL   | `renderOrder: -1`                                  |       | [molecular-clouds/](molecular-clouds/README.md) |
| Molecular cloud absorption                       | WebGL   | `renderOrder: -2`                                  | back  | [molecular-clouds/](molecular-clouds/README.md) |
| Milky Way volume + Local Group emission          | WebGL   | `renderOrder: -3`                                  |       | [milkyway/](milkyway/README.md), [local-group/](local-group/README.md) |
| Star core depth-mask (depth-only)                | WebGL   | `renderOrder: -4`, `colorWrite: false`             | back  | [star-pipeline/](star-pipeline/README.md) |

### Per-layer visibility gates and tuning

Each layer owns its own visibility gates, magnitude cutoffs, and
shader tuning in its README. Look there when investigating a
"layer-isn't-showing" or "wrong layer wins this pixel" report.

The two cross-layer pinning rules `stellata.ts` is responsible for:

- **The `-4` core depth mask** runs first so background layers (MW,
  clouds, galactic grid — all with `depthTest: true`) depth-fail
  behind close-range bright star cores instead of bleeding through.
  Stars alone hold the slot: a planet body is a spheroid mesh plus one
  additive glare, and the mesh writes its depth in the local pass.
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
  same way (`star-pipeline/local-pass/star-local-cluster.ts`). The
  `planet-body-field` test pins the pass renderOrders; a reorder
  fails CI rather than silently regressing.
  See [local-depth/](local-depth/README.md).

Within the same `renderOrder` value, the opaque-before-transparent
rule of the three.js renderer determines order; opaque depth-write
meshes establish the depth buffer that transparent passes test
against.

Rows above the local-depth boundary render in a second, depth-cleared
pass *after* the whole main stack, ordered against each other by a
bracketed standard-depth z-buffer (the in-pass renderOrder only
sequences opaque-before-transparent) — see
[local-depth/](local-depth/README.md). While the solar-system cluster
is inactive (camera beyond the cull range, or chart mode) its bodies
render through the ordinary main-pass planet/star rows instead.
