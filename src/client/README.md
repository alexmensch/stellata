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
  **Only the critical kind module may reject out of `main.ts`'s boot
  `Promise.all`** — the star catalog, whose absence leaves nothing to
  render, and whose rejection the surrounding catch turns into the error
  screen. Every other loader that rejects blanks the whole app, so an
  optional artifact must resolve null instead — including on a parse
  error, since `not_found_handling = "single-page-application"`
  (`wrangler.toml`) answers a missing asset with index.html at 200 rather
  than a 404. `solar-system/probes/probe-loader.ts` is the pattern to copy;
  warn-then-null on a present-but-invalid artifact
  (`local-group/local-group-loader.ts`) is the shape for shape errors. For
  kind modules the rule is enforced rather than trusted — `loadKindModules`
  swallows every non-`critical` rejection (`kinds/README.md`).
- `stellata-events.test.ts` — integration-shell event-emission test.
- `kinds/` — the `ObjectKindModule` / `KindContext` contracts and the
  kind-module roster: one module per `TargetKind` (all six migrated)
  supplies load/attach + every capability leg, and the shell/boot
  iterate the roster instead of hand-wiring each site.
- `frame/` — the floating-origin service (`FloatingOrigin`: worldOffset,
  recentre fan-out, anchor-policy seam) and the shared view/screen
  uniform map every render pass holds by reference.
- `util/` — project-agnostic plumbing (event bus, URL state).
- `filters/` — `FilterState` + the instrument record (aperture-derived
  limiting magnitude, plate-scale star sizing) + render knobs and the
  `FilterController` that owns every mutation.
- `scene/` — the `SceneLayer` contract + registry driving the
  per-layer update / monochrome / recenter / dispose fan-outs.
- `render-gate/` — the on-demand render gate: `animate()` skips the
  draw (and the `'frame'` emit) on ticks where nothing invalidated the
  frame. Its README owns the invalidation-source inventory and the
  hold contract.
- `chrome-lines/` — the renderer-neutral seam the line overlays take
  their strokes from (orbit rings, binary orbit paths, probe trails, the
  constellation figure, the IAU boundary arcs, the galactic disc, both
  coordinate spheres, the Local Group wireframe), plus the WebGL2
  implementation. Its README carries why the local depth pass makes the
  seam mandatory rather than tidy, and why the fat stroke is the one that
  brings its own object.
- `hdr/` — the float render target every light-emitting layer draws
  into and the fullscreen tone-map that resolves it to the canvas.
  Owns the shared operator chunk, its CPU mirror, and the chrome
  colour inverse-mapping. `hdr/exposure/` owns the scalar they run on —
  instrument limit, per-frame scene adaptation, EV trim — and
  `hdr/exposure/reduction/` reduces the target's statistic attachment
  to the three numbers the cut runs on. Chart mode bypasses all of it.
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
- `attitude/` — the gyro-sphere attitude indicator: an FDAI-style 8-ball
  reading the camera quaternion against a reference frame that follows the
  focused object (ecliptic / equatorial / galactic, plus a captured REF
  datum and an ORB one on the focused object's own orbital plane), with
  click-, double-click-, `L`-, `Shift`+`L`- and right-click affordances.
  Draws on its own
  small WebGL context rather than the main one, to stay clear of the HDR
  target and its exposure.
- `calibration/` — the display-calibration screen: authored sRGB step
  wedge, black-point and highlight ladders, and gamma match patches.
  Deliberately outside the `hdr/` path — it shows the display's own
  transfer, not the operator's output.
- `system-membership/` — kind-generic multi-object system contract
  (roster + collapsed-cluster queries) behind the hover system card
  and collapsed-pick-to-primary resolution; implemented by
  `binaries/` and `solar-system/`.
- `loaders/` — runtime fetch/parse of `public/` artifacts.
- `webgpu/` — the WebGPU dual-boot seam: the `#renderer=webgpu` flag,
  the async renderer boot behind a dynamic-import boundary, the
  port scaffolding (shared uniform nodes, TSL shim, attribute packing,
  the TSL test pattern), and the ported TSL layers (`webgpu/star/`,
  `webgpu/solar-system/`, `webgpu/hdr/`, `webgpu/extinction/`,
  `webgpu/chrome-lines/`). Flag on
  renders the seam's own scene — layers accumulate there as port children
  land — while every CPU subsystem runs identically; flag off leaves the
  shipped boot untouched. `webgpu/gate/` is the exception to the folder's
  dynamic-import boundary: the "requires WebGPU" page has to render where
  WebGPU does not exist, so `main.ts` imports it statically. It lands
  dark — only `#webgpu-gate=<verdict>` reaches it until the cutover.

## Public surface of `Stellata`

The shell exposes its controllers as readonly namespaces rather than
forwarding to them: `focus`, `warp`, `observe`, `aim`, `roll`, `filters`,
`exposure`, `adaptation`, `pois`, `input`, `hdr`, `kinds`, plus the
`milkyway` / `hud` layer handles, `chartLabels`, and the debug-scoped
`localDepthPass` / `reduction` handles (frame-cost levers,
`debug/frame-cost/README.md`), `sceneGraphs` (read-only handles on every
scene this boot draws, for the memory inventory —
`debug/memory/README.md`; PLURAL because a dual boot renders the seam's
scene and not the shell's, so either alone prices a scene that is not on
screen), and `renderGate` (`render-gate/README.md`). Callers write
`stellata.filters.setFilter(patch)`; each namespace's own README is the
reference for what it answers. `camera/README.md` § Camera mode covers
the one split pair (read on `focus`, write on `observe`).

**A method on the shell itself is composition, not forwarding** — it
does something no single controller can. Keep that property when adding
one: `setCameraFov` (syncs the pixel solid angle to the HDR seam),
`aimAt` / `aimAtConstellation` (cross-controller busy gates),
`isCameraTransitionActive` (warp ∪ observe), `getT` / `setT`
(clockJumped fan-out), the `FrameAnchor` recentre trio, `setMonochrome`,
the `attach*` family, and the star-frame reads (`localPositions`,
`starLocalPositionInto`, `uniforms`) exposing the shell-owned star
render machinery. A new zero-logic pass-through belongs on the
controller.

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
  overlays. Not a per-rAF heartbeat: a tick the render gate skips
  emits nothing (`render-gate/README.md`).
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
state mutation), and the warp-end edge emit alone. The pairing also runs
the other way once: a discrete clock jump has no fine-grained event of
its own and emits bare `'state'` from
`Stellata.notifyClockJumped()`.

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

The renderer runs in a **floating local frame** whose origin tracks the
focused object, because Three.js composes `modelViewMatrix` at float32
and a star a kiloparsec from Sol otherwise jitters by pixels every frame.
`frame/README.md` owns all of it — the service, the recentre fan-out
order, the anchor policy, the focus/unfocus invariants and the URL
`worldOffset` field.

The one rule every layer must respect: **projection and camera math read
`stellata.localPositions`; distance-from-Sol reads `catalog.positions`**
(or sums back to absolute in float64). Mixing the two frames is the
recurring bug this design creates.

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
statistic attachment ([hdr/attachments/](hdr/attachments/README.md)); every
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
| Planet labels                                    | SVG     | source order                                       |       | [solar-system/planets/labels/](solar-system/planets/labels/README.md) |
| Probe labels                                     | SVG     | source order                                       |       | [solar-system/probes/](solar-system/probes/README.md) |
| POI labels                                       | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| POI rings                                        | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| POI arrows                                       | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Sol/GC arrow labels                              | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| Distance label + warp pill                       | SVG     | source order                                       |       | [overlays/](overlays/README.md), [camera/warp/](camera/warp/README.md) |
| Distance vector + bg                             | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Sol/GC arrows + bg                               | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| HUD ring                                         | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| Chart labels + glyphs (chart only)               | SVG     | source order (three groups)                        |       | [chart-mode/labels/](chart-mode/labels/README.md) |
| Coordinate-sphere edge labels                    | SVG     | source order (first SVG children)                  |       | [galactic/coord-spheres/](galactic/coord-spheres/README.md) |
| *— SVG / WebGL boundary —*                       | —       | `.overlay { z-index: 5 }`                          | —     | — |
| Planet glow mirror (cluster members)             | WebGL   | local depth pass; bracket z-buffer (4 in-pass)     |       | [solar-system/planets/](solar-system/planets/README.md), [local-depth/](local-depth/README.md) |
| Member-star glow mirror                          | WebGL   | local depth pass (3.5 in-pass)                     |       | [star-pipeline/local-pass/](star-pipeline/local-pass/README.md), [local-depth/](local-depth/README.md) |
| Probe marker mirror (cluster active)              | WebGL   | local depth pass (3.3 in-pass)                     |       | [solar-system/probes/](solar-system/probes/README.md), [local-depth/](local-depth/README.md) |
| Probe trail mirror (cluster active)               | WebGL   | local depth pass (3.25 in-pass)                    |       | [solar-system/probes/](solar-system/probes/README.md), [local-depth/](local-depth/README.md) |
| Orbit rings                                      | WebGL   | local depth pass (3.2 in-pass)                     |       | [solar-system/ephemerides/](solar-system/ephemerides/README.md), [local-depth/](local-depth/README.md) |
| Binary orbit paths                               | WebGL   | local depth pass (3.2 in-pass)                     |       | [binaries/orbit-paths/](binaries/orbit-paths/README.md), [local-depth/](local-depth/README.md) |
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
