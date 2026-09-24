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
  per-layer update / monochrome / recenter / dispose fan-outs, and the
  full render stack: which layer wins which pixel, canvas and SVG
  (`scene/README.md` § Full render stack — front to back).
- `render-gate/` — the on-demand render gate: `animate()` skips the
  draw (and the `'frame'` emit) on ticks where nothing invalidated the
  frame. Its README owns the invalidation-source inventory and the
  hold contract.
- `chrome-lines/` — the renderer-neutral seam the line overlays take
  their strokes from (orbit rings, binary orbit paths, probe trails, the
  constellation figure, the IAU boundary arcs, the galactic disc, both
  coordinate spheres, the Local Group wireframe). Its README carries why the local depth pass makes the
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
- `occlusion/` — the frame's near-solid-body set and the angular test
  over it. SVG composites above the resolved frame with no depth
  relationship to it, so a label surface asks here whether a nearer
  body hides its anchor. Published by the two local-depth clusters.
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
  (material seam + gating base) used by the heliopause and the Local
  Bubble.
- `hover/`, `overlays/`, `ui/`, `typeahead/`, `modals/`, `debug/` —
  cross-cutting UI.
- `attitude/` — the gyro-sphere attitude indicator: an FDAI-style 8-ball
  reading the camera quaternion against a reference frame that follows the
  focused object (ecliptic / equatorial / galactic, plus a captured REF
  datum and an ORB one on the focused object's own orbital plane — the
  latter owned by `attitude/orbit-frame/`), with click-, double-click-,
  `L`-, `Z`- and right-click affordances, plus three corner chips —
  the datum chip (off / REF / TGT), the frame flag, and INV, which swings the
  camera to the reciprocal of the direction it holds. Lives in the bottom-left Instruments panel and is
  **navigate-only**: observe draws a coordinate sphere instead, and the two
  never share the screen. Draws on its own small WebGL context rather than
  the main one, to stay clear of the HDR target and its exposure.
- `calibration/` — the display-calibration screen: authored sRGB step
  wedge, black-point and highlight ladders, and gamma match patches.
  Deliberately outside the `hdr/` path — it shows the display's own
  transfer, not the operator's output.
- `system-membership/` — kind-generic multi-object system contract
  (roster + collapsed-cluster queries) behind the hover system card
  and collapsed-pick-to-primary resolution; implemented by
  `binaries/` and `solar-system/`.
- `loaders/` — runtime fetch/parse of `public/` artifacts.
- `webgpu/` — **the renderer this app boots.** The capability route, the
  async renderer boot behind a dynamic-import boundary, the authoring
  scaffolding (shared uniform nodes, TSL shim, storage attributes, the
  TSL test pattern), and the TSL layers (`webgpu/star/`,
  `webgpu/solar-system/`, `webgpu/hdr/`, `webgpu/extinction/`,
  `webgpu/chrome-lines/`). Every CPU subsystem is backend-blind, and the
  seam owns no scene — layers add to the one below.
  `webgpu/gate/` and `webgpu/boot-route.ts` are the exceptions to the
  folder's dynamic-import boundary: the "requires WebGPU" page has to
  render where WebGPU does not exist, so `main.ts` imports both
  statically. There is no fallback renderer.

## Boot in two waves

`main.ts` boots in two waves, because the catalogue streams
(`loaders/README.md` § Progressive catalog load). Wave 1 ends at first
paint, on the catalogue's FIRST chunk; wave 2 waits on
`kinds.star.ready` — the complete record set plus the search index.
Four things follow, and each has cost a defect:

- **A wave-1 consumer sees a prefix, not the catalogue.** Anything
  walking records, or reading a table built from them, either bounds
  itself at `catalog.loadedCount` or grows per chunk via
  `catalog.onRecordsDecoded`. Deferring it to wave 2 is the third
  option and the one that needs justifying — `applyFromUrl` runs in
  wave 1, so any table it reads has to exist by then.
- **A wave-1 affordance whose wiring is in wave 2 is a dead control.**
  The chrome comes up at first paint; anything it drives that is not
  bound yet is disabled until it is, never merely left inert. The
  topbar search inputs are the instance — disabled with a loading
  placeholder until `bindSearch` runs. Chart mode is the counter-example
  that had to move the other way: `applyFromUrl` may have already turned
  it on, so binding it late paints the realistic style and then flips the
  whole sky, and it binds in wave 1 over a table filled in wave 2
  (`typeahead/README.md`).
- **Wave 2 yields a frame between steps.** The scene is live by then,
  so a run of catalogue-wide table builds freezes it for their sum
  unless each hands the render loop a frame.
- **A wave-1 read of a wave-2-backed value returns a plausible zero, not
  an error**, and that is the defect shape this split keeps producing.
  An unattached optional field coalesces (`binaryOrbitField?.…  ?? false`
  reports "no perturbation" and "not attached" identically), an unfilled
  buffer slot reads `(0,0,0)`, and a still-filling index answers off its
  prefix. Nothing throws, so the wrong value is *kept* and surfaces later
  somewhere unrelated — a camera parked on a bare baseline, a pin that
  disengages on the next mode exit. Sampling such a value in wave 1 means
  owning its reconciliation when the real one lands; a delta-tracking
  consumer cannot, since it only ever sees CHANGES. Making this a contract
  rather than a habit is `stellata-cns.16`.

## Public surface of `Stellata`

The shell exposes its controllers as readonly namespaces rather than
forwarding to them: `focus`, `warp`, `observe`, `aim`, `roll`, `filters`,
`exposure`, `adaptation`, `pois`, `input`, `hdr`, `kinds`, `declutter`,
`solarSystem`, plus the
`milkyway` / `hud` layer handles, `chartLabels`, and the debug-scoped
`localDepthPass` / `reduction` handles (frame-cost levers,
`debug/frame-cost/README.md`), `sceneGraphs` (read-only handles on every
scene this boot draws, for the memory inventory —
`debug/memory/README.md`), and `renderGate`
(`render-gate/README.md`). Callers write
`stellata.filters.setFilter(patch)`; each namespace's own README is the
reference for what it answers. `camera/README.md` § Camera mode covers
the one split pair (read on `focus`, write on `observe`).

**A method on the shell itself is composition, not forwarding** — it
does something no single controller can. Keep that property when adding
one: `setCameraFov` (syncs the pixel solid angle to the HDR seam),
`aimAt` / `aimAlong` / `aimAtConstellation` / `invertView`
(cross-controller busy gates, shared as `claimCameraForAim` — it reports
whether the camera was free *and* cancels the focus lerps, so every aim
takes it the same way),
`isCameraTransitionActive` (warp ∪ observe), `getT` / `setT`
(clockJumped fan-out) and `setMonochrome`. A new zero-logic pass-through
belongs on the controller.

**Forwarders still on the shell leave with their cluster, and so do their
callers** (§ Decomposing the shell). The `attach*` family — `main.ts` calls
`attachBinaries`, `attachDust` and `attachConstellationBoundaries` — moves
with its row, and `main.ts` calls the new owner through a readonly
namespace. The star-frame reads (`localPositions`, `uniforms`) and the
`FrameAnchor` methods (`recenterOrigin`, `getWorldOffset`,
`starLocalPosition`, `starLocalPositionInto`) forward to `starFrame` and
`floatingOrigin`; with the star render machinery, the focus controller's
`frameAnchor` dep is built from those two owners directly, and outside
readers of `stellata.getWorldOffset()` read the floating origin's
namespace. No extraction leaves a method behind that only forwards.

**Install seams are the other admissible shape**, and they are not
pass-throughs: a UI surface built after the shell registers itself here so
code that only holds a `Stellata` can reach it. `setOrbitFrameTick` (the
attitude instrument's per-frame ORB re-read, whose *ordering* only the scene
registry can express) and `setOrbitFramePort` / `getOrbitFramePort` (ORB and
the orbit lock on the share URL — state no controller owns,
`util/url-state/README.md` § ORB and the orbit lock) are both of that kind.
Each reads through its field every time, so installing after construction
works exactly as a lazily-attached layer does, and `dispose` clears both.

## Decomposing the shell

`stellata.ts` is headed for wiring only — construct, connect, dispose
(epic `stellata-hhaw.32`). Its fields fall into clusters: fields read and
written together, plus the methods touching them. Each cluster leaves for
the named folder with its tests; which fields and methods it takes is its
bead's description, and the order is the bead graph's (`bd show
stellata-hhaw.32`), not this table's.

`tests/integration-shell-ratchet.test.ts` is what holds the file to the
rule: every `Stellata` field is either composition that stays or awaiting
extraction, a new field in neither fails, and an extraction deletes its
fields from the awaiting list. **Every bead named in this section leaves
with the PR that closes it** — a row, a cross-row bullet, a clause — and
the last extraction (32.15) deletes the section, leaving the ratchet with
an empty awaiting list.

| Cluster | Target | Bead |
| --- | --- | --- |
| Focal rides | `camera/focus/` | `hhaw.32.2` |
| Star size + pick | the kind table (`kinds/`, `camera/focus/`) | `hhaw.32.4` |
| Binaries | `binaries/` | `hhaw.32.5` |
| Dust + extinction | `star-pipeline/extinction/` | `hhaw.32.6` |
| Dust particles (shelved) | `dust/`, or removed — a product call | `hhaw.32.7` |
| Constellations | `constellation-figure/`, `constellation-boundaries/` | `hhaw.32.8` |
| Galactic + HUD | `galactic/`, `overlays/` | `hhaw.32.10` |
| Star render machinery | `star-pipeline/` | `hhaw.32.13` |
| Frame loop — last | `scene/frame-loop/` | `hhaw.32.15` |

**Values crossing a row boundary** — whichever row moves first settles the
interface for both:

- The frame's camera velocity — owned by `ClockCadence`
  (`render-gate/cadence/README.md` § The controller); `applyRideDelta`
  reports each ride step through `noteRideStep`, and the rides take that
  call with them. `maybeReAdvanceEpoch`'s translate skips it today — the
  suspected bug 32.2 carries.
- **The binaries rate** — `binaryOrbitField?.cadenceReport(cc) ??
  CADENCE_REPORT_STILL` maxed with the eclipse field's, written out in four
  entries: the binary walk, and the star-local-cluster, core-mask and
  constellation-figure entries of other rows. The first of 32.13 / 32.8 to
  move lifts it into one shell function and takes it as a `(cc) =>
  CadenceReport` callback; the callback's type carries no `null`, so the
  not-ready answer stays inside the provider for 32.5 and cns.16 to change
  in one place.
- **The planet rate** — settled as `solarSystem.planetRate`, a `(cc) =>
  CadenceReport` (`solar-system/README.md` § Wiring); the moving-focal-ride
  entry takes it, and the rides carry that `rate` with them.

### Late-attached slots

A cluster holding a value that lands after construction cannot move without
choosing how "not yet" is represented — the question `stellata-cns.16`
answers. **So cns.16's design lands before the binaries, dust + extinction
and constellation extractions**, and each of those implements its contract
once rather than moving a `T | null` twice. The focal rides read the binaries
slot, so they follow both. A cluster that reaches a late slot only through
the binaries rate — the star render machinery — does not wait: it takes the
rate as a callback (above), which leaves the slot behind. Clusters holding
no late slot do not wait either.

| Slot | Lands | Not-ready answer today |
| --- | --- | --- |
| Binaries (both fields + table) | wave 2, after `kinds.star.ready`; also handed to `starLocalCluster.setBinaries` | `?.… ?? false` (the focus controller's perturbation read), `?? CADENCE_REPORT_STILL` (the binaries rate), `?? []`, `?? 0`, `binariesData` null in the orbit-path focus handler, the binary ride skipped |
| Dust + extinction prepass | when the dust manifest resolves — no wave | `?.` no-op; `extinctionAvMagFor` 0 (deliberately pickable); `isExtinctionPrepassActive` false; survivor `inFrame` null |
| Boundary namer + label anchors | after construction; optional artifact | `null` / `[]`, read as "not yet" |
| Dust-particle source | first opt-in | shelved |
| Orbit-frame tick + port | after construction | `null` = neither armed nor locked |

Two catalogue-prefix reads also sit in the shell: the constellation figure
and `aimAtConstellation`'s centroid read figure vertices from
`localPositions` in wave 1. The figure re-reads every frame, so a vertex
outside the loaded prefix draws at `(0,0,0)` only until its chunk lands;
the centroid is read once per aim and keeps whatever it got. Both are safe
while every vertex sits in chunk 0 — measured on today's build (the
`lines` indices in `public/constellations.json` against
`recordsInFirstChunk`): 708 distinct vertices, highest record index
10,288, chunk 0 ending at 10,411, a margin of 124 records that nothing
checks yet.
The build-time assert is 32.8's; the read is an instance on cns.16.
A third prefix read sits outside the shell: the extinction prepass sorts its
dispatch order over the table it attaches to, which is normally still
streaming, and re-sorts once on the refresh that completes it
(`webgpu/extinction/README.md` § What a CACHE owes) — another cns.16 instance,
answered inside the pass.

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
the other way, for the two mutations that are URL state with no
fine-grained event of their own — each emits bare `'state'`: a discrete
clock jump, from `Stellata.notifyClockJumped()`, and ORB / the orbit lock,
from `Stellata.notifyOrbitFrameChanged()`. **A mutation the URL carries but
no event announces reaches the address bar only by luck** — the URL writer
otherwise wakes on `'state'` or on a detected pose change, and engaging the
orbit lock moves neither.

## Click-state machine (`camera/controls/input/input-controller.ts`)

Canvas clicks in BOTH modes are held for `DBL_CLICK_MS` (280 ms) by a
shared `PendingClickDispatcher` (`util/pending-click.ts`) so single
and double clicks disambiguate; the deferred handlers re-check the
warp / aim / transition guards at fire time.

Navigate clicks resolve the object under the cursor across EVERY
registered kind at once (`Picker.pickAnyKindHit`, driven by the kind
roster rather than a written-out list), tiebroken by the hover engine's
own rule (`bestHitBy`: tightest enclosing surface wins, camera distance
never) so click and hover can't disagree on which object wins an
overlap. A shell therefore never takes a click aimed at a star or a
cloud it encloses, and a new kind competes correctly the moment its
module registers a pick (`hover/README.md` Rule 3).

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
click-destination-to-travel). Only the ACTION differs — which object the
click resolves to is settled by the same roster-wide comparison as every
other kind; folding clouds onto the ladder's rungs is its own bead.

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
